import React, { Component, render } from 'preact-compat';
import Rating from 'react-star-rating-component';
import rgbHex from 'rgb-hex';

const toHex = ({ red, green, blue, alpha }) => `#${rgbHex(red, green, blue, alpha / 255)}`;

const stateFromExtension = extension => ({
  maxRating: extension.parameters.instance.maxRating,
  starsColor: toHex(extension.parameters.instance.starsColor),
  value: extension.getFieldValue(extension.fieldPath),
});

window.DatoCmsExtension.init().then((extension) => {
  extension.startAutoResizer();

  class Input extends Component {
    constructor(props) {
      super(props);
      this.state = stateFromExtension(extension);
    }

    componentDidMount() {
      this.unsubscribe = extension.addFieldChangeListener(extension.fieldPath, () => {
        this.setState(stateFromExtension(extension));
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
          onStarClick={newValue => extension.setFieldValue(extension.fieldPath, newValue)}
          value={value}
          starCount={maxRating}
          starColor={starsColor}
        />
      );
    }
  }

  render(<Input />, document.body);
});
