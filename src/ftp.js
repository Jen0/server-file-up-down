const Spinners = require("../lib/spinners.json");
const path = require("path");
const fs = require("fs-extra");
const FtpClient = require("ftp");
const ora = require("ora");
const chalk = require("chalk");
chalk.level = Math.max(chalk.level, 1);
const ProgressBar = require("progress");

/**
 *
 * @param {Object} param progressBar参数
 * @param {Number} param.total 总数
 */
const getProgressBarOption = ({ total } = {}) => ({
  complete: "=",
  incomplete: " ",
  width: 20,
  total,
  clear: true,
  humanFriendlyRate: true, // 开启速率单位KB，默认byte
});

/**
 * 验证字符串是否在资源中
 * @param {String} str
 * @param {String|Array} resources
 */
const isInclude = (str, resources) => {
  if (!str || !resources) return false;
  if (Array.isArray(resources)) {
    if (resources.length === 0) return false;
    return resources.includes(str);
  }
  return str === resources;
};

const formatSymbol = (str) => str.replace(/\\/g, "/");

const operationTypeEnums = {
  upload: "上传",
  download: "下载",
};

/**
 * ftp连接成功
 * @param {Object} ftp
 */
const ready = (ftp) => {
  return new Promise((resolve, reject) => {
    ftp.on("ready", () => {
      resolve();
    });
  });
};
/**
 * 重启一个文件
 * @param {Object} ftp
 * @param {Number} byteOffset
 */
const restart = (ftp, byteOffset = 0) => {
  return new Promise((resolve, reject) => {
    ftp.restart(byteOffset, (err) => {
      err && reject(err);
      resolve();
    });
  });
};
/**
 * 删除远程文件
 * @param {Object} ftp
 * @param {String} filePath
 */
const rmFile = (ftp, filePath) => {
  return new Promise((resolve, reject) => {
    ftp.delete(filePath, (err) => {
      err && reject(err);
      resolve();
    });
  });
};

/**
 * 删除远程文件夹
 * @param {Object} ftp
 * @param {String} filePath
 */
const rmFolder = (ftp, folderPath) => {
  return new Promise((resolve, reject) => {
    ftp.rmdir(folderPath, true, (err) => {
      err && reject(err);
      resolve();
    });
  });
};

/**
 * 查看远程指定目录下的文件、文件夹
 * @param {Object} ftp
 * @param {String} filePath
 */
const findFiles = (ftp, folderPath) => {
  return new Promise((resolve, reject) => {
    ftp.list(folderPath, false, (err, files) => {
      err && reject(err);
      resolve(files);
    });
  });
};

/**
 * 创建远程文件夹
 * @param {Object} ftp
 * @param {String} remotePath
 */
const mkdir = (ftp, remotePath) => {
  return new Promise((resolve, reject) => {
    ftp.mkdir(remotePath, true, (err) => {
      err && reject(err);
      resolve();
    });
  });
};

/**
 * 切换远程工作目录
 * @param {Object} ftp
 * @param {String} remotePath
 */
const cwd = (ftp, remotePath) => {
  return new Promise((resolve, reject) => {
    ftp.cwd(remotePath, (err, currentDir) => {
      err && reject(err);
      resolve(currentDir);
    });
  });
};

/**
 * 查询远程文件的大小
 * @param {Object} ftp
 * @param {String} remotePath
 */
const getSize = (ftp, remotePath) => {
  return new Promise((resolve, reject) => {
    ftp.size(remotePath, (err, numBytes) => {
      err && reject(err);
      resolve(numBytes);
    });
  });
};

/**
 * 默认配置
 */
const defaultOptions = {
  targetPath: path.resolve(process.cwd(), "dist"), // 本地目录
  remotePath: "", // 远程目录，默认根目录
  excludeExt: "", // 排除文件后缀 ['zip']
  excludeFolder: "", // 排除文件夹 ['folder']
  clean: false, // 是否需要清理远程目录，默认false
  cleanExcludeExt: "",
  cleanExcludeFolder: "",
  cleanExcludeFiles: "",
};

/**
 * 创建ftp实例，并连接
 * @param {Object} options
 */
const createFtpInstance = (options) => {
  // 创建实例
  const ftp = new FtpClient();
  // 连接服务器
  ftp.connect(options);
  return ftp;
};

/**
 * 创建ftp实例，并连接
 * @param {Object} options
 */
const reConnectFtp = async (options) => {
  this.ftp = createFtpInstance(options);
  await ready(this.ftp);
  await restart(this.ftp);
};

class ServerFileUpDown {
  /**
   * @param {Object} connectOption 服务器连接配置
   * @param {Object} options 该插件参数配置
   */
  constructor(connectOption, options) {
    this.options = Object.assign({}, defaultOptions, options);
    // 创建实例
    this.ftp = createFtpInstance((this.connectOption = connectOption));
    // 记录原始pasvTimeout
    this.originPasvTimeout = this.connectOption.pasvTimeout;
  }

  init() {
    // 进度
    this.progress = null;
    this.fileCache = [];
    // 计数器
    this.count = 0;
  }

  /**
   * 清理远程目录
   */
  async rmRemoteDir() {
    // 出现加载图标
    const spinner = ora({
      text: chalk.bold.greenBright(`正在清理远程目录，请耐心等待...`),
      spinner: Spinners.bouncingBall,
    });
    spinner.start();
    const {
      remotePath,
      targetPath,
      cleanExcludeExt,
      cleanExcludeFolder,
      cleanExcludeFiles,
    } = this.options;
    const recursiveRmDir = async (currentDir = "") => {
      const currentRemotePath = `${remotePath}/${currentDir}`;
      // 删除文件夹
      try {
        await rmFolder(this.ftp, currentRemotePath);
      } catch (e) {
        let files = [];
        // 文件夹内有权限，遍历文件
        try {
          files = await findFiles(this.ftp, currentRemotePath);
        } catch (notFoundErr) {
          // 文件夹不存在
          // reject(notFoundErr)
          spinner.fail(
            chalk.redBright(
              `清理远程目录失败！原因：不存在${remotePath}该目录`
              // 2. 没有权限删除其中有些文件`
            )
          );
        }
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const fileRelativePath = currentDir
            ? `${currentDir}/${f.name}`
            : f.name;
          const remoteFullPath = `${remotePath}/${fileRelativePath}`;
          // 只能删除有操作权限的文件
          if (f.type === "-" && f.rights.user.indexOf("x") !== -1) {
            // 不需要删除的文件（判断是否排除文件，还有排除后缀）
            if (
              !(
                isInclude(path.extname(f.name), cleanExcludeFiles) ||
                isInclude(path.extname(f.name).substr(1), cleanExcludeExt)
              )
            ) {
              await rmFile(this.ftp, remoteFullPath);
            }
          } else if (f.type === "d" && f.name.indexOf(".") !== 0) {
            // 不需要删除的文件夹
            if (!isInclude(f.name, cleanExcludeFolder)) {
              await recursiveRmDir(fileRelativePath);
            }
          }
        }
      }
    };
    await recursiveRmDir();
    spinner.succeed(chalk.greenBright(`清理远程目录成功！\r\n`));
    // this.ftp.rmdir(remotePath, true, (err) => {
    //   if (err) {
    //     spinner.fail(
    //       chalk.redBright(
    //         `清理远程目录失败！原因：
    //           1. 不存在${remotePath}该目录
    //           2. 没有权限删除其中有些文件`
    //         )
    //         );
    //   } else spinner.succeed(chalk.greenBright(`清理远程目录成功！\r\n`));
    //   resolve();
    // });
  }
  /**
   * 下载文件
   */
  async download() {
    await ready(this.ftp);
    const { remotePath } = this.options;
    // 初始化
    this.init();
    const startTime = Number(new Date());
    this.progress = ora({
      text: chalk.bold.greenBright(`正在下载 ，请耐心等待...`),
      spinner: Spinners.bouncingBall,
    });
    this.progress.start();
    try {
      this.fileCache = await this.circleExecute(
        undefined,
        this.recursiveCollectDownloadFile.bind(this)
      );
      if (this.fileCache.length === 0) {
        throw new Error(`远程目录：${remotePath} 是空目录，没有文件可下载！`);
      }
      await this.downloadMultipleFileToFtpServer();
      this.progress.succeed(
        chalk.greenBright(
          `下载成功！总共${this.fileCache.length}个文件，耗时: ${
            Number(new Date()) - startTime
          }ms\r\n`
        )
      );
    } catch (e) {
      this.progress.fail(chalk.red(`${e}`));
    } finally {
      this.progress && this.progress.clear();
      this.ftp.destroy();
    }
  }
  /**
   * 上传文件
   */
  async upload() {
    await ready(this.ftp);
    const { clean, targetPath } = this.options;
    // 初始化
    this.init();
    // 执行开始时间
    const startTime = Number(new Date());
    // 出现加载图标
    this.progress = ora({
      text: chalk.bold.greenBright(`正在向服务器上传文件 ，请耐心等待...`),
      spinner: Spinners.bouncingBall,
    });
    this.progress.start();
    try {
      this.fileCache = this.recursiveCollectUploadFile();
      if (this.fileCache.length === 0) {
        throw new Error(`${targetPath} 是空目录，没有文件可上传！`);
      }
      clean && (await this.rmRemoteDir());
      await this.uploadMultipleFileToFtpServer();
      // 结束加载图标
      this.progress.succeed(
        chalk.greenBright(
          `上传成功！总共${this.fileCache.length}个文件，耗时: ${
            Number(new Date()) - startTime
          }ms\r\n`
        )
      );
    } catch (e) {
      this.progress.fail(chalk.red(`${e}`));
    } finally {
      this.progress && this.progress.clear();
      this.ftp && this.ftp.destroy();
    }
  }

  /**
   * 递归收集一个文件夹中的所有File
   */
  async recursiveCollectDownloadFile() {
    const { excludeExt, excludeFolder, remotePath, targetPath } = this.options;
    const collectFiles = [];

    const collect = async (currentDir = "") => {
      const files = await findFiles(this.ftp, `${remotePath}/${currentDir}`);
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const fileRelativePath = currentDir
          ? `${currentDir}/${f.name}`
          : f.name;
        if (f.type === "-") {
          // 不需要收集的文件
          if (!isInclude(path.extname(f.name).substr(1), excludeExt)) {
            collectFiles.push({
              remoteDir: currentDir
                ? `${remotePath}/${currentDir}`
                : remotePath || "/",
              fileName: f.name,
              fileRelativePath: currentDir,
            });
          }
        } else if (f.type === "d" && f.name.indexOf(".") === -1) {
          // 不需要收集的文件夹
          if (!isInclude(f.name, excludeFolder)) {
            await collect(fileRelativePath);
          }
        }
      }
    };
    await collect();
    return collectFiles;
  }
  /**
   * 递归收集一个文件夹中的所有File
   */
  recursiveCollectUploadFile() {
    const { excludeExt, excludeFolder, targetPath } = this.options;
    const collectFiles = [];
    /**
     * 收集文件
     * @param {String} currentDir 当前目录路径--相对路径
     */
    const collect = (currentDir = "") => {
      const direntArr = fs.readdirSync(targetPath + "/" + currentDir, {
        withFileTypes: true,
      });
      direntArr.forEach((dirent) => {
        const direntRelativePath = currentDir
          ? `${currentDir}/${dirent.name}`
          : dirent.name;
        // 是文件，就收集
        if (dirent.isFile()) {
          // 不需要收集的文件
          if (isInclude(path.extname(dirent.name).substr(1), excludeExt))
            return;
          collectFiles.push({
            remoteDir: formatSymbol(currentDir),
            fileRelativePath: direntRelativePath,
            // buffer: fs.readFileSync(path.resolve(distPath, direntRelativePath))
          });
        } else {
          // 不需要收集的文件夹
          if (isInclude(dirent.name, excludeFolder)) return;
          collect(direntRelativePath);
        }
      });
    };
    // 开始收集
    collect();
    return collectFiles;
  }

  /**
   * 上传多文件至ftp服务器
   */
  uploadMultipleFileToFtpServer() {
    return new Promise(async (resolve, reject) => {
      for (let i = 0, files = this.fileCache; i < files.length; i++) {
        try {
          await this.circleExecute(
            files[i],
            this.uploadFileToFtpServer.bind(this)
          );
          this.validateEnd("upload") && resolve();
        } catch (e) {
          reject(e);
        }
      }
    });
  }
  /**
   * 解决上传超时的问题，如果超时，将超时时间递归扩大2倍，继续上传
   * @param {Object} file file
   * @param {Function} executiveFn 可执行函数
   * @param {Boolean} errorFlag  是否超时报错
   */
  async circleExecute(file, executiveFn, errorFlag) {
    // 是否是原来的间隔时间
    // const isOriginPasvTimeout =
    //   this.connectOption.pasvTimeout == this.originPasvTimeout;

    // 超时，或者 (没有超时并且不是原来的间隔时间)
    // if (errorFlag || (!errorFlag && !isOriginPasvTimeout)) {
    // 如果不是原始的间隔时间，就重新初始化连接
    // else {
    //   this.connectOption.pasvTimeout = this.originPasvTimeout;
    // }
    // }

    // 时间延长2倍，重新连接
    if (errorFlag) {
      this.connectOption.pasvTimeout = 2 * this.connectOption.pasvTimeout;
      await reConnectFtp(this.connectOption);
    }

    try {
      const res = await executiveFn(file);
      return res;
    } catch (e) {
      if (e.message.indexOf("Timed out while making data connection") !== -1) {
        this.ftp && this.ftp.destroy();
        this.ftp = null;
        return await this.circleExecute(file, executiveFn, true);
      }
    }
  }
  /**
   * 上传文件至ftp服务器
   */
  uploadFileToFtpServer(file) {
    return new Promise(async (resolve, reject) => {
      const ftp = this.ftp;
      const { targetPath, remotePath } = this.options;
      try {
        await mkdir(ftp, `${remotePath}/${file.remoteDir}`);
        await restart(ftp);
        await this.putFile(
          path.resolve(targetPath, file.fileRelativePath),
          `${remotePath}/${formatSymbol(file.fileRelativePath)}`
        );
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 上传文件
   * @param {String} localPath
   * @param {String} remotePath
   */
  putFile(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      const file = fs.createReadStream(localPath),
        currentStateStr = this.showCurrentProgress("upload"),
        total = fs.statSync(localPath).size,
        bar = new ProgressBar(currentStateStr, getProgressBarOption({ total }));
      file.on("data", (d) => {
        this.progress.stop();
        bar.tick(d.length);
      });
      this.ftp.put(file, remotePath, (err) => {
        err && reject(err);
        this.progress.start();
        resolve();
      });
    });
  }

  /**
   * 下载远程文件
   * @param {String} remoteFilePath
   * @param {Object} file
   */
  getStream(remoteFilePath, file) {
    return new Promise(async (resolve, reject) => {
      const { targetPath } = this.options;
      const total = await getSize(this.ftp, remoteFilePath);
      this.ftp.get(remoteFilePath, async (err, res) => {
        err && reject(err);
        const currentStateStr = this.showCurrentProgress("download");
        const bar = new ProgressBar(
          currentStateStr,
          getProgressBarOption({ total })
        );
        if (res) {
          res.on("data", (chunk) => {
            this.progress.stop();
            bar.tick(chunk.length);
          });
          // 服务器指定路径开始下载
          fs.ensureDirSync(path.resolve(targetPath, file.fileRelativePath));
          const ws = fs.createWriteStream(
            path.resolve(targetPath, file.fileRelativePath, file.fileName)
          );
          res.pipe(ws);
          res.on("end", () => {
            ws.end();
            this.progress.start();
            resolve(res);
          });
        }
      });
    });
  }
  /**
   * 下载服务器多文件至本地
   */
  downloadMultipleFileToFtpServer() {
    return new Promise(async (resolve, reject) => {
      try {
        for (let i = 0, files = this.fileCache; i < files.length; i++) {
          const file = files[i];
          await this.circleExecute(
            file,
            this.downloadFileToFtpServer.bind(this)
          );
          this.validateEnd("download") && resolve();
        }
      } catch (e) {
        reject(e);
      }
    });
  }
  /**
   * 下载服务器文件至本地
   */
  downloadFileToFtpServer(file) {
    return new Promise(async (resolve, reject) => {
      const remoteDir =
        file.remoteDir.indexOf("/") === 0
          ? file.remoteDir.substr(1)
          : file.remoteDir;
      try {
        await cwd(this.ftp, `/${remoteDir}`);
        await this.getStream(`/${remoteDir}/${file.fileName}`, file);
        resolve();
      } catch (err) {
        err && reject(err);
      }
    });
  }
  /**
   * 判断是否结束
   */
  validateEnd(type) {
    this.count++;
    this.progress.color = "blue";
    this.progress.text = chalk.greenBright(
      `正在${operationTypeEnums[type]}文件，当前进度：${chalk.redBright(
        this.count
      )}/${this.fileCache.length}`
    );
    this.progress.start();
    if (this.count === this.fileCache.length) {
      return true;
    }
    return false;
  }
  /**
   * 显示对应文件上传、下载进度
   * @param {String} type
   */
  showCurrentProgress(type) {
    return chalk.greenBright(
      `正在${
        operationTypeEnums[type]
      }文件，当前进度：[:bar] :rate/bps :current/:total :percent :elapseds ${chalk.redBright(
        this.count
      )}/${chalk.blueBright(this.fileCache.length)}`
    );
  }
}

module.exports = ServerFileUpDown;
