const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackTagsPlugin = require('html-webpack-tags-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  entry: `${__dirname}/src/index.jsx`,
  mode: process.env.NODE_ENV,
  output: {
    path: `${__dirname}/dist`,
    filename: 'bundle.js',
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
        include: `${__dirname}/src`,
        loader: 'eslint-loader',
        enforce: 'pre',
      },
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
    alias: {
      react: 'preact-compat',
      'react-dom': 'preact-compat',
      'create-react-class': 'preact-compat/lib/create-react-class',
      'react-dom-factories': 'preact-compat/lib/react-dom-factories',
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'Star rating editor plugin',
      minify: isProduction,
    }),
    new HtmlWebpackTagsPlugin({
      append: false,
      publicPath: '',
      tags: [
        'https://unpkg.com/datocms-plugins-sdk@0.0.9/dist/sdk.js',
        'https://unpkg.com/datocms-plugins-sdk@0.0.9/dist/sdk.css',
      ],
    }),
  ].filter(Boolean),
};
