import React, { Component, render } from 'preact-compat';
import Rating from 'react-star-rating-component';
import rgbHex from 'rgb-hex';

const toHex = ({
  red,
  green,
  blue,
  alpha,
}) => `#${rgbHex(red, green, blue, alpha / 255)}`;

const stateFromPlugin = plugin => ({
  maxRating: plugin.parameters.instance.maxRating,
  starsColor: toHex(plugin.parameters.instance.starsColor),
  value: plugin.getFieldValue(plugin.fieldPath),
});

window.DatoCmsPlugin.init().then((plugin) => {
  plugin.startAutoResizer();

  class Input extends Component {
    constructor(props) {
      super(props);
      this.state = stateFromPlugin(plugin);
    }

    componentDidMount() {
      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        this.setState(stateFromPlugin(plugin));
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    render() {
      const { maxRating, value, starsColor } = this.state;

      return (
        <Rating
          name="star"
          onStarClick={newValue => plugin.setFieldValue(plugin.fieldPath, newValue)}
          value={value}
          starCount={maxRating}
          starColor={starsColor}
        />
      );
    }
  }

  render(<Input />, document.body);
});
