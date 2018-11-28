import React from 'react';
import PropTypes from 'prop-types';
import distanceInWords from 'date-fns/distance_in_words';
import format from 'date-fns/format';

export default class AutoUpdateTime extends React.Component {
  static propTypes = {
    value: PropTypes.instanceOf(Date).isRequired,
  };

  componentDidMount() {
    this.ticker = setInterval(this.invalidate, 3000);
  }

  componentWillUnmount() {
    if (this.ticker) {
      clearInterval(this.ticker);
    }
  }

  invalidate = () => {
    this.forceUpdate();
  }

  render() {
    const { value } = this.props;

    if (!value) {
      return '';
    }

    return (
      <span>
        {format(value, 'MMM D')}
        &nbsp;
        (
        {distanceInWords(new Date(), value)}
        &nbsp;ago)
      </span>
    );
  }
}
