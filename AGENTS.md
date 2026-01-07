# 在vscode中也能拥有typora的图片粘贴功能

这是一个VScode扩展，当用户在vscode 编辑markdown文件时，如果用户粘贴图片到markdown文件中，扩展会自动将图片复制到markdown文件同级目录下的 ./{markdown文件名}.assets/ 目录下，并将图片的相对路径插入到markdown文件中。



## 本地打包安装自测

```
pnpm run compile
pnpm dlx @vscode/vsce package
code --install-extension <生成的 .vsix 文件路径>
```

## 上传到云端

```
https://marketplace.visualstudio.com/manage/publishers/zhaoolee
```
