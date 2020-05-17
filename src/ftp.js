const Spinners = require("../lib/spinners.json");
const path = require("path");
const fs = require("fs-extra");
const FtpClient = require("ftp");
const ora = require("ora");
const chalk = require("chalk");
chalk.level = Math.max(chalk.level, 1);
/**
 * 验证字符串是否在资源中
 * @param {String} str
 * @param {String|Array} resources
 */
const isInclude = (str, resources) => {
  if (str && resources) {
    if (Array.isArray(resources)) {
      return resources.includes(str);
    }
    return str === resources;
  }
  return true;
};

const formatSymbol = (str) => str.replace(/\\/g, "/");

const operationTypeEnums = {
  upload: "上传",
  download: "下载",
};

/**
 * 上传文件至ftp服务器
 */
const uploadFileToFtpServer = function (ftp, file, options) {
  return new Promise((resolve, reject) => {
    const { targetPath, remotePath } = options;
    ftp.mkdir(`${remotePath}/${file.remoteDir}`, true, (err) => {
      err && reject(err);
      ftp.put(
        path.resolve(targetPath, file.fileRelativePath),
        // file.buffer,
        `${remotePath}/${formatSymbol(file.fileRelativePath)}`,
        function (err) {
          err && reject(err);
          resolve();
        }
      );
    });
  });
};

/**
 * 下载服务器文件至本地
 */
const downloadFileToFtpServer = (ftp, file, options) => {
  return new Promise((resolve, reject) => {
    const { targetPath, remotePath } = options;
    const remoteDir =
      file.remoteDir.indexOf("/") === 0
        ? file.remoteDir.substr(1)
        : file.remoteDir;
    ftp.cwd(`/${remoteDir}`, (e, currentDir) => {
      ftp.get(`/${remoteDir}/${file.fileName}`, (err, rs) => {
        err && reject(err);
        if (rs) {
          // console.log(remoteDir, file.fileRelativePath, file.fileName);
          // 服务器指定路径开始下载
          fs.ensureDirSync(path.resolve(targetPath, file.fileRelativePath));
          let ws = fs.createWriteStream(
            path.resolve(targetPath, file.fileRelativePath, file.fileName)
          );
          // 服务器根目录开始下载
          // fs.ensureDirSync(path.resolve(targetPath, remoteDir));
          // let ws = fs.createWriteStream(
          //   path.resolve(targetPath, remoteDir, file.fileName)
          // );
          rs.pipe(ws);
          resolve();
        }
      });
    });
  });
};

/**
 * 默认配置
 */
const defaultOptions = {
  targetPath: path.resolve(process.cwd(), "dist"), // 本地目录
  remotePath: "", // 远程目录，默认根目录
  excludeExt: [], // 排除文件后缀 ['zip']
  excludeFolder: [], // 排除文件夹 ['folder']
  clean: false, // 是否需要清理远程目录，默认false
};

class ServerFileUpDown {
  static createInstance() {
    if (ServerFileUpDown.ftpInstance) return ServerFileUpDown.ftpInstance;
    return new FtpClient();
  }

  /**
   * @param {Object} connectOption 服务器连接配置
   * @param {Object} options 该插件参数配置
   */
  constructor(connectOption, options) {
    this.options = {
      ...defaultOptions,
      ...options,
    };

    // 创建实例
    this.ftp = ServerFileUpDown.createInstance();
    // 连接服务器
    this.ftp.connect(connectOption);
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
  rmRemoteDir() {
    return new Promise((resolve, reject) => {
      // 出现加载图标
      const spinner = ora({
        text: chalk.bold.greenBright(`正在清理远程目录，请耐心等待...`),
        spinner: Spinners.bouncingBall,
      });
      spinner.start();
      const { remotePath } = this.options;
      this.ftp.rmdir(remotePath, true, (err) => {
        if (err) {
          spinner.fail(
            chalk.redBright(
              `清理远程目录失败！原因：不存在${remotePath}该目录\r\n`
            )
          );
        } else spinner.succeed(chalk.greenBright(`清理远程目录成功！\r\n`));
        resolve();
      });
    });
  }
  /**
   * 下载文件
   */
  download() {
    return new Promise((resolve, reject) => {
      this.ftp.on("ready", async () => {
        const { remotePath } = this.options;
        // 初始化
        this.init();
        const startTime = Number(new Date());
        this.progress = ora({
          text: chalk.bold.greenBright(`正在下载 ，请耐心等待...`),
          spinner: Spinners.bouncingBall,
        });
        try {
          this.progress.start();
          this.fileCache = await this.recursiveCollectDownloadFile();

          if (this.fileCache.length === 0) {
            throw new Error(
              `远程目录：${remotePath} 是空目录，没有文件可下载！`
            );
          }
          await this.downloadMultipleFileToFtpServer();
          this.progress.succeed(
            chalk.greenBright(
              `下载成功！总共${this.fileCache.length}个文件，耗时: ${
                Number(new Date()) - startTime
              }ms\r\n`
            )
          );
          resolve();
        } catch (e) {
          this.progress.fail(chalk.red(`${e}`));
          reject(e);
        } finally {
          this.progress && this.progress.clear();
          this.ftp.destroy();
        }
      });
    });
  }
  /**
   * 上传文件
   */
  upload() {
    return new Promise((resolve, reject) => {
      this.ftp.on("ready", async () => {
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
        try {
          this.fileCache = this.recursiveCollectUploadFile();
          if (this.fileCache.length === 0) {
            throw new Error(`${targetPath} 是空目录，没有文件可上传！`);
          }
          clean && (await this.rmRemoteDir());

          this.progress.start();
          await this.uploadMultipleFileToFtpServer();
          // 结束加载图标
          this.progress.succeed(
            chalk.greenBright(
              `上传成功！总共${this.fileCache.length}个文件，耗时: ${
                Number(new Date()) - startTime
              }ms\r\n`
            )
          );
          resolve();
        } catch (e) {
          this.progress.fail(chalk.red(`${e}`));
          reject(e);
        } finally {
          this.progress && this.progress.clear();
          this.ftp.destroy();
        }
      });
    });
  }

  /**
   * 递归收集一个文件夹中的所有File
   */
  async recursiveCollectDownloadFile() {
    const { excludeExt, excludeFolder, targetPath } = this.options;
    const collectFiles = [];
    const collect = (currentDir = "") => {
      return new Promise((resolve, reject) => {
        const { remotePath } = this.options;
        this.ftp.list(
          `${remotePath}/${currentDir}`,
          false,
          async (err, files) => {
            err && reject(err);
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
            resolve();
          }
        );
      });
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
    return new Promise((resolve, reject) => {
      this.fileCache.forEach(async (file) => {
        try {
          await uploadFileToFtpServer(this.ftp, file, this.options);
          this.validateEnd("upload") && resolve();
        } catch (e) {
          reject(e);
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
        const files = this.fileCache;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          await downloadFileToFtpServer(this.ftp, file, this.options);
          this.validateEnd("download") && resolve();
        }
      } catch (e) {
        reject(e);
      }
    });
  }
  /**
   * 判断是否结束
   */
  validateEnd(type) {
    this.count++;
    // 如果上传了所有的文件，就关闭ftp
    this.progress.color = "blue";
    this.progress.text = chalk.greenBright(
      `正在${operationTypeEnums[type]}文件，当前进度：${chalk.redBright(
        this.count
      )}/${this.fileCache.length}`
    );
    if (this.count === this.fileCache.length) {
      return true;
    }
    return false;
  }
}

module.exports = ServerFileUpDown;
