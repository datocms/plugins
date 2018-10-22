const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackIncludeAssetsPlugin = require('html-webpack-include-assets-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  entry: __dirname + '/src/index.jsx',
  mode: process.env.NODE_ENV,
  output: {
    path: __dirname + '/dist',
    filename: 'bundle.js'
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        include: __dirname + '/src',
        loader: 'eslint-loader',
        enforce: 'pre',
      },
      {
        test: /\.jsx?$/,
        exclude: /(node_modules|bower_components)/,
        use: { loader: 'babel-loader' }
      },
      {
        test: /\.sass$/,
        use: [
          "style-loader",
          "css-loader",
          "sass-loader"
        ]
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'Tag editor plugin',
      minify: isProduction,
    }),
    new HtmlWebpackIncludeAssetsPlugin({
      append: false,
      publicPath: '',
      assets: isProduction ?
        [
          'https://unpkg.com/datocms-plugins-sdk@0.0.5/dist/sdk.js',
          'https://unpkg.com/datocms-plugins-sdk@0.0.5/dist/sdk.css',
        ]
        :
        [
          'http://localhost:5001/sdk.js',
          'http://localhost:5001/sdk.css',
        ]
    }),
  ].filter(Boolean),
}
