import React, { Component, render } from 'preact-compat';
import Client from './client';

import './style/index.sass';

const stateFromPlugin = plugin => ({
  shopifyDomain: plugin.parameters.global.shopifyDomain,
  storefrontAccessToken: plugin.parameters.global.storefrontAccessToken,
  value: plugin.getFieldValue(plugin.fieldPath),
});

window.DatoCmsPlugin.init().then((plugin) => {
  plugin.startAutoResizer();

  class Input extends Component {
    constructor(props) {
      super(props);

      this.state = Object.assign(
        {
          searchResults: [],
        },
        stateFromPlugin(plugin),
      );

      this.client = new Client(this.state);
    }

    componentDidMount() {
      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        const newState = stateFromPlugin(plugin);
        this.setState(newState);
        this.client = new Client(newState);
      });

      this.performSearch();
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    performSearch(query) {
      (
        query
          ? this.client.fetchProductsMatching(query)
          : this.client.fetchFirstProducts()
      ).then((products) => {
        this.setState({ searchResults: products });
      });
    }

    handleSubmit(e) {
      e.preventDefault();
      this.performSearch(this.el.value);
    }

    renderProduct(product) {
      return (
        <div className="product" key={product.handle}>
          <div
            className="product__image"
            style={{ backgroundImage: `url(${product.imageUrl})` }}
          />
          <div className="product__title">
            {product.title}
          </div>
        </div>
      );
    }

    render() {
      const { searchResults } = this.state;

      return (
        <div>
          <form className="search" onSubmit={this.handleSubmit.bind(this)}>
            <div className="search__input">
              <input
                placeholder="Search products..."
                type="text"
                ref={(el) => { this.el = el; }}
              />
            </div>
            <button
              className="DatoCMS-button--primary"
              type="submit"
            >
              Search
            </button>
          </form>
          <div className="products">
            {searchResults.map(this.renderProduct, this)}
          </div>
        </div>
      );
    }
  }

  render(<Input />, document.body);
});
