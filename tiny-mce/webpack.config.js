const HtmlWebpackPlugin = require("html-webpack-plugin");
const HtmlWebpackTagsPlugin = require("html-webpack-tags-plugin");

const isProduction = process.env.NODE_ENV === "production";
const path = __dirname + "/dist";

module.exports = {
  entry: __dirname + "/src/index.js",
  mode: process.env.NODE_ENV,
  output: {
    path,
    filename: "bundle.js",
  },
  devtool: "source-map",
  devServer: {
    static: {
      directory: path,
    },
    compress: true,
    port: 5000,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        include: __dirname + "/src",
        loader: "eslint-loader",
        enforce: "pre",
      },
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components)/,
        use: { loader: "babel-loader" },
      },
      {
        test: /\.sass$/,
        use: ["style-loader", "css-loader", "sass-loader"],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: "DatoCMS Plugin",
      minify: isProduction,
    }),
    new HtmlWebpackTagsPlugin({
      append: false,
      publicPath: "",
      tags: [
        "https://unpkg.com/datocms-plugins-sdk@0.1.1/dist/sdk.js",
        "https://unpkg.com/datocms-plugins-sdk@0.1.1/dist/sdk.css",
      ],
    }),
  ].filter(Boolean),
};
