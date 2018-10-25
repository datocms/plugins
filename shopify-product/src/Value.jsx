import React, { Component } from 'preact-compat';
import PropTypes from 'prop-types';
import cn from 'classname';
import Client from './client';
import Price from './Price.jsx';

export default class Value extends Component {
  propTypes = {
    value: PropTypes.string.isRequired,
    client: PropTypes.instanceOf(Client).isRequired,
    onReset: PropTypes.func.isRequired,
  }

  constructor(props) {
    super(props);

    this.state = {
      product: null,
      status: null,
    };
  }

  componentDidMount() {
    const { value } = this.props;

    this.findProduct(value);
  }

  findProduct(handle) {
    const { client } = this.props;

    this.setState({ status: 'loading' });

    client.fetchProductByHandle(handle).then((product) => {
      this.setState({ product, status: 'success' });
    });
  }

  render() {
    const { onReset } = this.props;
    const { product, status } = this.state;

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
