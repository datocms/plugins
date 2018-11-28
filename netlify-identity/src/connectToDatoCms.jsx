import React, { Component } from 'react';

export default mapPluginToProps => BaseComponent => (
  class ConnectToDatoCms extends Component {
    constructor(props) {
      super(props);
      this.state = mapPluginToProps(props.plugin);
    }

    componentDidMount() {
      const { plugin } = this.props;

      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        this.setState(mapPluginToProps(plugin));
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    render() {
      return <BaseComponent {...this.props} {...this.state} />;
    }
  }
);
