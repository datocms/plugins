const HtmlWebpackPlugin = require('html-webpack-plugin')
const IncludeAssets = require('html-webpack-include-assets-plugin')

const isProduction = process.env.NODE_ENV === 'production'

module.exports = {
  entry: `${__dirname}/src/index.js`,
  mode: process.env.NODE_ENV,
  output: {
    path: `${__dirname}/dist`,
    filename: 'bundle.js',
  },
  devtool: 'source-map',
  devServer: {
    contentBase: './',
    disableHostCheck: true,
    public: 'https://datocms-disabled-field.eu.ngrok.io',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        include: `${__dirname}/src`,
        loader: 'eslint-loader',
        enforce: 'pre',
      },
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components)/,
        use: {loader: 'babel-loader'},
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'DatoCMS Plugin',
      minify: isProduction,
    }),
    new IncludeAssets({
      append: false,
      usePublicPath: false,
      assets: [
        'https://unpkg.com/datocms-plugins-sdk@0.0.10/dist/sdk.js',
        'https://unpkg.com/datocms-plugins-sdk@0.0.10/dist/sdk.css',
      ],
    }),
  ].filter(Boolean),
}