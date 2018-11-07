import React, { Component, render } from 'preact-compat';
import { Provider } from 'react-redux';

import Empty from './Empty.jsx';
import Value from './Value.jsx';
import store from './store';
import Client from './client';

import './style/index.sass';

const hrefToId = href => href && href.match(/[^/]+$/)[0];

const stateFromPlugin = plugin => ({
  apiToken: plugin.parameters.global.apiToken,
  value: hrefToId(plugin.getFieldValue(plugin.fieldPath)),
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
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    handleSelect = (form) => {
      plugin.setFieldValue(plugin.fieldPath, form._links.display);
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

  render(
    <Provider store={store}>
      <Input />
    </Provider>,
    document.body,
  );
});
