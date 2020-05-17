const { FTP } = require("../index");
const path = require("path");
(async () => {
  const ftp = new FTP(
    {
      host: "192.168.1.11",
      port: 21,
      user: "user",
      password: "admin",
      connTimeout: 1000 * 10, // 连接超时时间
      pasvTimeout: 1000 * 1, // PASV data 连接超时时间
      keepalive: 1000 * 10, // 多久发送一次请求，以保持连接
    },
    {
      targetPath: path.resolve(process.cwd(), "dist"),
      excludeExt: ["zip"],
      excludeFolder: ["img"],
      remotePath: "js",
      clean: false,
    }
  );

  console.log("start");
  // await ftp.upload();
  await ftp.download();
  console.log("over");
})();
