import React, { Component, render } from 'preact-compat';

import Client from './client';
import Empty from './Empty.jsx';
import Value from './Value.jsx';

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

      this.state = stateFromPlugin(plugin);
      this.client = new Client(this.state);
    }

    componentDidMount() {
      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        const newState = stateFromPlugin(plugin);
        this.setState(newState);
        this.client = new Client(newState);

        const { value } = this.state;

        if (newState.value !== value && newState.value) {
          this.findProduct(newState.value);
        }
      });

      const { value } = this.state;

      if (value) {
        this.findProduct(value);
      }
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    handleSelect = (product) => {
      plugin.setFieldValue(plugin.fieldPath, product.handle);
    }

    handleReset = () => {
      plugin.setFieldValue(plugin.fieldPath, null);
    }

    render() {
      const { value } = this.state;

      return value
        ? <Value client={this.client} value={value} onReset={this.handleReset} />
        : <Empty client={this.client} onSelect={this.handleSelect} />;
    }
  }

  render(<Input />, document.body);
});
