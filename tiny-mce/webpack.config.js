const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlWebpackTagsPlugin = require('html-webpack-tags-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  entry: `${__dirname}/src/index.js`,
  mode: process.env.NODE_ENV,
  resolve: {
    extensions: ['.js'],
  },
  output: {
    path: `${__dirname}/dist`,
    filename: '[name].js',
    clean: true,
  },
  devtool: 'source-map',
  devServer: {
    static: {
      directory: `${__dirname}/dist`,
    },
    compress: true,
    port: 5000,
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
        use: { loader: 'babel-loader' },
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'DatoCMS Plugin',
      minify: isProduction,
    }),
    new HtmlWebpackTagsPlugin({
      append: false,
      publicPath: '',
      tags: [
        'https://unpkg.com/datocms-plugins-sdk@0.1.2/dist/sdk.js',
        'https://unpkg.com/datocms-plugins-sdk@0.1.2/dist/sdk.css',
      ],
    }),
    new MiniCssExtractPlugin(),
  ].filter(Boolean),
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        tinymceVendor: {
          test: /[\\/]node_modules[\\/](tinymce)[\\/](.*js|.*skin.css)|[\\/]plugins[\\/]/,
          name: 'tinymce',
        },
      },
    },
  },
};
