import lorem from 'lorem-ipsum';

import {
  t,
  title,
  times,
  sentences,
  toHtml,
  rand,
  email,
  url,
  toMarkdown,
} from './text';

import './style.sass';

function article(buttons) {
  const s = (count = rand(2, 4)) => sentences(count, buttons);

  if (buttons.includes('heading') || buttons.includes('format')) {
    return [
      t('h1', title()),
      t('h2', title()),
      times(rand(1, 2)).map(() => t('p', s())),
      buttons.includes('unordered_list') && t('h2', title()),
      buttons.includes('unordered_list') && t('p', s()),
      buttons.includes('unordered_list') && t('ul', ...times(3).map(() => t('li', t('p', s(rand(1, 3)))))),
      buttons.includes('quote') && t('h2', title()),
      buttons.includes('quote') && t('p', s()),
      buttons.includes('quote') && t('blockquote', s(4)),
    ].filter(x => !!x);
  }

  return [
    times(rand(1, 2)).map(() => t('p', s())),
    buttons.includes('unordered_list') && t('ul', ...times(3).map(() => t('li', t('p', s(rand(1, 3)))))),
    buttons.includes('unordered_list') && t('p', s()),
    buttons.includes('quote') && t('blockquote', s(4)),
    buttons.includes('quote') && t('p', s()),
  ].filter(x => !!x);
}

window.DatoCmsPlugin.init((ext) => {
  const label = 'Fill with dummy content';

  const link = document.createElement('a');

  const { fieldPath } = ext;

  link.textContent = label;
  link.href = '#';
  link.classList.add('button');
  document.body.appendChild(link);

  ext.startAutoResizer();

  link.addEventListener('click', (e) => {
    e.preventDefault();

    const { attributes: field } = ext.field;

    if (field.field_type === 'string') {
      if (field.validators.format && field.validators.format.predefined_pattern === 'email') {
        ext.setFieldValue(fieldPath, email());
      } else if (field.validators.format && field.validators.format.predefined_pattern === 'url') {
        ext.setFieldValue(fieldPath, url());
      } else {
        ext.setFieldValue(fieldPath, title());
      }
    } else if (field.appeareance.editor === 'markdown') {
      ext.setFieldValue(fieldPath, toMarkdown(article(field.appeareance.parameters.toolbar)));
    } else if (field.appeareance.editor === 'wysiwyg') {
      ext.setFieldValue(fieldPath, toHtml(article(field.appeareance.parameters.toolbar)));
    } else {
      ext.setFieldValue(fieldPath, lorem({ units: 'paragraphs', count: 3 }));
    }
  });
});
