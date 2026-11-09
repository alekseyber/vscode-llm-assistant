// webpack.config.js — сборка VS Code extension
const path = require('path');

/** @type {import('webpack').Configuration} */
module.exports = {
  target: 'node', // VS Code extension работает в Node.js окружении
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    // Чистим каталог: иначе вывод `tsc` (если его запускали) остаётся рядом с бандлом
    // и уезжает в VSIX мёртвым грузом — именно так пакет однажды собрался из tsc-модулей.
    clean: true,
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode' // VS Code API — внешняя зависимость
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  stats: {
    warnings: true,
    errors: true
  }
};