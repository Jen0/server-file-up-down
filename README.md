<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

**Table of Contents** _generated with [DocToc](https://github.com/thlorenz/doctoc)_

- [server-upload-download](#server-upload-download)
  - [安装](#%e5%ae%89%e8%a3%85)
  - [使用](#%e4%bd%bf%e7%94%a8)
  - [参数配置](#%e5%8f%82%e6%95%b0%e9%85%8d%e7%bd%ae)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

# server-upload-download

> 目前仅支持 `ftp` 上传/下载

## 安装

```bash
npm i server-upload-download
```

## 使用

```js
const { FTP } = require("server-upload-download");

// for example
(async () => {
  // 参数参考 https://github.com/mscdex/node-ftp
  const connectionOptions = {
    host: "192.168.1.11",
    port: 21,
    user: "user",
    password: "password",
    connTimeout: 1000 * 10, // 连接超时时间
    pasvTimeout: 1000 * 0.3, // 每个文件上传间隔时间
    keepalive: 1000 * 10, // 多久发送一次请求，以保持连接
  };
  // 参数参考如下表格
  const options = {
    targetPath: path.resolve(process.cwd(), "dist"),
    excludeExt: ["zip"],
    excludeFolder: ["img"],
    remotePath: "js",
    clean: false,
  };
  const ftp = new Ftp(connectionOptions, options);

  console.log("start");
  // 上传
  // await ftp.upload();
  // 下载
  await ftp.download();
  console.log("over");
})();
```

## 参数配置

|     属性      |        类型        |            默认值            | 必填 | 上传说明                                                                                    | 下载说明               |
| :-----------: | :----------------: | :--------------------------: | :--: | ------------------------------------------------------------------------------------------- | ---------------------- |
|  targetPath   |       string       | 本地项目根目录下的`dist`目录 |  是  | 上传本地项目根目录`dist`目录下的所有文件，必须是绝对路径                                    |                        | 下载至本地的目录，必须是绝对路径 |
|  remotePath   |       string       |          远程根目录          |  否  | 远程目录，填写相对路径                                                                      | 远程目录，填写相对路径 |
|  excludeExt   | string \| string[] |                              |  否  | `string`: 过滤一个后缀(e.g. 'zip')，`string[]`: 过滤多个后缀(e.g. ['zip','txt'])            | 同左                   |  |
| excludeFolder | string \| string[] |                              |  否  | `string`: 过滤一个目录(e.g. 'folder')，`string[]`: 过滤多个目录(e.g. ['folder1','folder2']) | 同左                   |
|     clean     |      boolean       |            false             |  否  | 上传前是否需要清理远程目录                                                                  |                        |
