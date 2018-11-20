import React, { Component } from 'preact-compat';
import PropTypes from 'prop-types';
import cn from 'classname';
import { connect } from 'react-redux';

import Client from './client';
import Price from './Price.jsx';
import { fetchProductByHandle } from './store';

@connect((state, props) => ({
  status: (
    state.products[props.value]
      ? state.products[props.value].status
      : 'loading'
  ),
  product: state.products[props.value].result,
}))

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

  findProduct(handle) {
    const { client, dispatch } = this.props;
    dispatch(fetchProductByHandle(handle, client));
  }

  render() {
    const { onReset, product, status } = this.props;

    return (
      <div className={cn('value', { loading: status === 'loading' })}>
        {
          product
            && (
              <div className="value__product">
                <div
                  className="value__product__image"
                  style={{ backgroundImage: `url(${product.imageUrl})` }}
                />
                <div className="value__product__info">
                  <div className="value__product__title">
                    <a
                      href={product.onlineStoreUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {product.title}
                    </a>
                  </div>
                  <div className="value__product__description">
                    {product.description}
                  </div>
                  <div className="value__product__product-type">
                    <strong>Product type:</strong>
                    &nbsp;
                    {product.productType}
                  </div>
                  <div className="value__product__price">
                    <strong>Price:</strong>
                    &nbsp;
                    {
                      (
                        product.priceRange.maxVariantPrice.amount
                          !== product.priceRange.minVariantPrice.amount
                      )
                        ? (
                          <span>
                            <Price {...product.priceRange.minVariantPrice} />
                            &nbsp;
                            -
                            &nbsp;
                            <Price {...product.priceRange.maxVariantPrice} />
                          </span>
                        )
                        : (
                          <Price {...product.priceRange.maxVariantPrice} />
                        )
                    }
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
