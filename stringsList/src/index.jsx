import React from 'react';
import { render } from 'react-dom';
import { WithContext as ReactTags } from 'react-tag-input';
import './reactTags.css';

function deserialize(extension) {
  const fieldValue = extension.getFieldValue(extension.fieldPath);

  if (!fieldValue) {
    return [];
  }

  if (extension.field.attributes.field_type === 'json') {
    return JSON.parse(fieldValue).map(key => ({ id: key, text: key }));
  }
  return fieldValue.split(',').map(key => ({ id: key, text: key }));
}

function serializeValue(inputValue, extension) {
  if (extension.field.attributes.field_type === 'json') {
    return JSON.stringify(inputValue.map(o => o.text));
  }
  return inputValue.map(o => o.text).join(', ');
}

window.DatoCmsExtension.init().then((extension) => {
  extension.startAutoResizer();

  class App extends React.Component {
    constructor(props) {
      super(props);
      this.state = { value: deserialize(extension) };
    }

    componentDidMount() {
      this.unsubscribe = extension.addFieldChangeListener(extension.fieldPath, () => {
        this.setState({ value: deserialize(extension) });
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    handleAddition(inputValue) {
      const { value } = this.state;

      extension.setFieldValue(
        extension.fieldPath, (
          serializeValue([...value, inputValue], extension)
        ),
      );
    }

    handleDelete(inputValue) {
      const { value } = this.state;
      value.splice(inputValue, 1);

      extension.setFieldValue(
        extension.fieldPath, (serializeValue(value, extension)),
      );
    }

    handleDrag(inputValue, currPos, newPos) {
      const { value } = this.state;
      const newValue = value.slice();

      newValue.splice(currPos, 1);
      newValue.splice(newPos, 0, inputValue);

      extension.setFieldValue(
        extension.fieldPath, (serializeValue(newValue, extension)),
      );
    }

    render() {
      const { value } = this.state;

      return (
        <div>
          <ReactTags
            tags={value}
            placeholder="Add new string"
            handleAddition={newValue => this.handleAddition(newValue)}
            handleDrag={newValue => this.handleDrag(newValue)}
            handleDelete={newValue => this.handleDelete(newValue)}
          />
        </div>
      );
    }
  }

  render(<App />, document.body);
});
