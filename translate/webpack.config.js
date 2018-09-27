const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackIncludeAssetsPlugin = require('html-webpack-include-assets-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  entry: __dirname + '/src/index.js',
  mode: process.env.NODE_ENV,
  output: {
    path: __dirname + '/dist',
    filename: 'bundle.js'
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'DatoCMS UI Extension',
      minify: isProduction,
    }),
    new HtmlWebpackIncludeAssetsPlugin({
      append: false,
      publicPath: '',
      assets: isProduction ?
        [
          'https://unpkg.com/datocms-ui-extensions-sdk/dist/sdk.js',
          'https://unpkg.com/datocms-ui-extensions-sdk/dist/sdk.css',
        ]
        :
        [
          'http://localhost:5001/sdk.js',
          'http://localhost:5001/sdk.css',
        ]
    }),
  ].filter(Boolean),
}
