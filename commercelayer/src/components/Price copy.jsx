import PropTypes from 'prop-types';

export default function Price({ amount, currencyCode }) {
  return (
    <span>
      {currencyCode}
      &nbsp;
      {amount}
    </span>
  );
}

Price.propTypes = {
  amount: PropTypes.number.isRequired,
  currencyCode: PropTypes.string.isRequired,
};
