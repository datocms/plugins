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
  devtool: 'source-map',
  devServer: {
    contentBase: './',
    disableHostCheck: true,
  },
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
      title: 'DatoCMS Plugin',
      minify: isProduction,
    }),
    new HtmlWebpackIncludeAssetsPlugin({
      append: false,
      publicPath: '',
      assets: [
        'https://unpkg.com/datocms-plugins-sdk@0.0.5/dist/sdk.js',
        'https://unpkg.com/datocms-plugins-sdk@0.0.5/dist/sdk.css',
      ]
    }),
  ].filter(Boolean),
}
