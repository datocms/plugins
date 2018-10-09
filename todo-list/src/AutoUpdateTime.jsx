import React from 'react';
import PropTypes from 'prop-types';
import distanceInWords from 'date-fns/distance_in_words';

export default class AutoUpdateTime extends React.Component {
  constructor(...args) {
    super(...args);
    this.invalidate = this.invalidate.bind(this);
  }

  componentDidMount() {
    this.ticker = setInterval(this.invalidate, 3000);
  }

  componentWillUnmount() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
  }

  invalidate() {
    this.forceUpdate();
  }

  render() {
    const { value } = this.props;

    return (
      <span>
        {distanceInWords(new Date(), value)}
        &nbsp;ago
      </span>
    );
  }
}

AutoUpdateTime.propTypes = {
  value: PropTypes.instanceOf(Date).isRequired,
};
