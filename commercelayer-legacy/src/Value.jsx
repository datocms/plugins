import React, { Component } from 'preact-compat';
import PropTypes from 'prop-types';
import cn from 'classname';
import { connect } from 'react-redux';

import Client from './client';
import { fetchProductByCode } from './store';

@connect((state, props) => {
  const product = state.products[props.value];

  return {
    status: product && product.status ? product.status : 'loading',
    product: product && product.result,
  };
})

export default class Value extends Component {
  propTypes = {
    value: PropTypes.string.isRequired,
    status: PropTypes.string.isRequired,
    product: PropTypes.object,
    client: PropTypes.instanceOf(Client).isRequired,
    onReset: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
  }

  componentDidMount() {
    const { value } = this.props;
    this.findProduct(value);
  }

  componentWillReceiveProps(nextProps) {
    const { value } = this.props;

    if (nextProps.value !== value && nextProps.value) {
      this.findProduct(nextProps.value);
    }
  }

  findProduct(code) {
    const { client, dispatch } = this.props;
    dispatch(fetchProductByCode(code, client));
  }

  render() {
    const {
      onReset,
      product,
      status,
      client,
    } = this.props;

    return (
      <div className={cn('value', { loading: status === 'loading' })}>
        {
          product
            && (
              <div className="value__product">
                <div
                  className="value__product__image"
                  style={{ backgroundImage: `url(${product.attributes.image_url})` }}
                />
                <div className="value__product__info">
                  <div className="value__product__title">
                    <a
                      href={`${client.baseEndpoint}/admin/skus/${product.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {product.attributes.name}
                    </a>
                  </div>
                  <div className="value__product__code">
                    SKU
                    &nbsp;
                    {product.attributes.code}
                  </div>
                  <div className="value__product__description">
                    {product.attributes.description}
                  </div>
                </div>
              </div>
            )
        }
        <button type="button" className="value__reset" onClick={onReset} />
      </div>
    );
  }
}
