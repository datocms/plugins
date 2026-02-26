// Enable modern CSS features (including native nesting) for broader browser support
// without changing authoring style.
module.exports = {
  plugins: [
    require('postcss-preset-env')({
      stage: 1,
      features: {
        'nesting-rules': true,
      },
    }),
  ],
};
