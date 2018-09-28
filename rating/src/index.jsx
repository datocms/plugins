import React, { Component, render } from 'preact-compat';
import Rating from 'react-star-rating-component';

function getStateFromExtension(extension) {
  return {
    starCount: extension.parameters.instance.maxRating,
    starColor: extension.parameters.instance.starColor,
    value: extension.getFieldValue(extension.fieldPath),
  };
}

window.DatoCmsExtension.init().then((extension) => {
  extension.startAutoResizer();

  class Input extends Component {
    constructor(props) {
      super(props);

      this.state = getStateFromExtension(extension);
    }

    componentDidMount() {
      this.unsubscribe = extension.addFieldChangeListener(extension.fieldPath, () => {
        this.setState(getStateFromExtension(extension));
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    render() {
      const { starCount, value } = this.state;

      return (
        <Rating
          name="star"
          onStarClick={newValue => extension.setFieldValue(extension.fieldPath, newValue)}
          value={value}
          starCount={starCount}
        />
      );
    }
  }

  render(<Input />, document.body);
});
