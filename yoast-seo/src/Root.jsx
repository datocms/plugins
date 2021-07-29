import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import Main from './Main';

const Root = ({ plugin }) => {
  const { htmlGeneratorUrl } = plugin.parameters.global;

  const [fieldValue, setFieldValue] = useState(
    plugin.getFieldValue(plugin.fieldPath),
  );

  useEffect(
    () => plugin.addFieldChangeListener(plugin.fieldPath, setFieldValue),
    [setFieldValue],
  );

  const [itemId, setItemId] = useState(plugin.itemId);
  useEffect(() => plugin.addChangeListener('itemId', setItemId), [setItemId]);

  return (
    <Main
      plugin={plugin}
      itemId={itemId}
      fieldValue={fieldValue}
      htmlGeneratorUrl={htmlGeneratorUrl}
    />
  );
};

Root.propTypes = {
  plugin: PropTypes.object.isRequired,
};

export default Root;
