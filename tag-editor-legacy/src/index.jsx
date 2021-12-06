import React from 'react';
import { render } from 'react-dom';
import { WithContext as ReactTags } from 'react-tag-input';
import './reactTags.css';

function deserialize(plugin) {
  const fieldValue = plugin.getFieldValue(plugin.fieldPath);

  if (!fieldValue) {
    return [];
  }

  if (plugin.field.attributes.field_type === 'json') {
    return JSON.parse(fieldValue).map(key => ({ id: key, text: key }));
  }
  return fieldValue.split(', ').map(key => ({ id: key, text: key }));
}

function serializeValue(inputValue, plugin) {
  if (plugin.field.attributes.field_type === 'json') {
    return JSON.stringify(inputValue.map(o => o.text));
  }
  return inputValue.map(o => o.text).join(', ');
}

window.DatoCmsPlugin.init().then((plugin) => {
  plugin.startAutoResizer();

  class App extends React.Component {
    constructor(props) {
      super(props);
      this.state = { value: deserialize(plugin) };
    }

    componentDidMount() {
      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        this.setState({ value: deserialize(plugin) });
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    handleAddition(inputValue) {
      const { value } = this.state;

      plugin.setFieldValue(
        plugin.fieldPath, (
          serializeValue([...value, inputValue], plugin)
        ),
      );
    }

    handleDelete(inputValue) {
      const { value } = this.state;
      value.splice(inputValue, 1);

      plugin.setFieldValue(
        plugin.fieldPath, (serializeValue(value, plugin)),
      );
    }

    handleDrag(inputValue, currPos, newPos) {
      const { value } = this.state;
      const newValue = value.slice();

      newValue.splice(currPos, 1);
      newValue.splice(newPos, 0, inputValue);

      plugin.setFieldValue(
        plugin.fieldPath, (serializeValue(newValue, plugin)),
      );
    }

    render() {
      const { value } = this.state;

      return (
        <div>
          <ReactTags
            tags={value}
            autofocus={false}
            placeholder="Add new string"
            handleAddition={this.handleAddition.bind(this)}
            handleDrag={this.handleDrag.bind(this)}
            handleDelete={this.handleDelete.bind(this)}
          />
        </div>
      );
    }
  }

  render(<App />, document.body);
});
