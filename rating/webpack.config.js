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
      }
    ],
  },
  resolve: {
    alias: {
      'react': 'preact-compat',
      'react-dom': 'preact-compat',
      'create-react-class': 'preact-compat/lib/create-react-class',
      'react-dom-factories': 'preact-compat/lib/react-dom-factories'
    }
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
