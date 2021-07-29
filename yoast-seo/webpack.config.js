const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackTagsPlugin = require('html-webpack-tags-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  entry: {
    main: path.join(__dirname, '/src/index.jsx'),
    worker: path.join(__dirname, '/src/worker.js'),
  },
  mode: process.env.NODE_ENV,
  output: {
    path: path.join(__dirname, '/dist'),
    filename: '[name].js',
  },
  devtool: 'source-map',
  devServer: {
    contentBase: './',
    disableHostCheck: true,
    public: 'http://localhost:5000',
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /(node_modules|bower_components)/,
        use: { loader: 'babel-loader' },
      },
      {
        test: /\.sass$/,
        use: ['style-loader', 'css-loader', 'sass-loader'],
      },
      {
        test: /\.svg/,
        use: {
          loader: 'svg-url-loader',
          options: {},
        },
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'DatoCMS plugin',
      minify: isProduction,
      excludeChunks: ['worker'],
    }),
    new HtmlWebpackTagsPlugin({
      append: false,
      publicPath: '',
      tags: [
        'https://unpkg.com/datocms-plugins-sdk@0.1.1/dist/sdk.js',
        'https://unpkg.com/datocms-plugins-sdk@0.1.1/dist/sdk.css',
      ],
    }),
  ].filter(Boolean),
};
