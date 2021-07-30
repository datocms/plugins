import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import Main from './Main';

const Root = ({ plugin }) => {
  const { htmlGeneratorUrl } = plugin.parameters.global;

  const [fieldValue, setFieldValue] = useState(
    plugin.getFieldValue(plugin.fieldPath) &&
      JSON.parse(plugin.getFieldValue(plugin.fieldPath)),
  );

  useEffect(
    () =>
      plugin.addFieldChangeListener(plugin.fieldPath, (value) =>
        setFieldValue(value && JSON.parse(value)),
      ),
    [setFieldValue],
  );

  const [itemId, setItemId] = useState(plugin.itemId);
  useEffect(() => plugin.addChangeListener('itemId', setItemId), [setItemId]);

  const [locale, setLocale] = useState(plugin.locale);
  useEffect(() => plugin.addChangeListener('locale', setLocale), [setLocale]);

  const [itemType, setItemType] = useState(plugin.itemType);
  useEffect(
    () => plugin.addChangeListener('itemType', setItemType),
    [setItemType],
  );

  const [environmentId, setEnvironmentId] = useState(plugin.environment);
  useEffect(
    () => plugin.addChangeListener('environment', setEnvironmentId),
    [setEnvironmentId],
  );

  const [isSubmitting, setIsSubmitting] = useState(plugin.isSubmitting);
  useEffect(
    () => plugin.addChangeListener('isSubmitting', setIsSubmitting),
    [setIsSubmitting],
  );

  return (
    <Main
      plugin={plugin}
      itemId={itemId}
      itemType={itemType}
      locale={locale}
      environmentId={environmentId}
      isSubmitting={isSubmitting}
      fieldValue={fieldValue}
      setFieldValue={(value) =>
        plugin.setFieldValue(plugin.fieldPath, JSON.stringify(value))
      }
      htmlGeneratorUrl={htmlGeneratorUrl}
    />
  );
};

Root.propTypes = {
  plugin: PropTypes.object.isRequired,
};

export default Root;
