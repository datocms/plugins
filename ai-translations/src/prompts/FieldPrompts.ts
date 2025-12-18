/**
 * FieldPrompts.ts
 * Field-specific output format hints appended to the base prompt.
 * Used to cue the LLM to return values in the expected DatoCMS field shape.
 */
export const fieldPrompt = {
  single_line: 'a single line string. Do not wrap the string in quotes',
  markdown:
    'markdown.  Do not add the ``markdown before the returned string, just return me a raw markdown string',
  wysiwyg:
    'HTML. Do not add the ``html before the returned string, just return me a raw html string',
  date_picker: 'a String value in ISO 8601 date format (ie. "2015-12-29")',
  date_time_picker:
    'a String values in ISO 8601 date-time format (ie. "2020-04-17T16:34:31.981+01:00")',
  integer:
    'an integer number that can be accepted into nodejs parseInt, the answer can only include numbers and no letters',
  float:
    'a float number that can be accepted into nodejs parseFloat the answer can only include numbers and no letters',
  boolean: 'a single character that can be 0 or 1, 0 for false, and 1 for true',
  map: 'A valid JSON string of an object with the following format: {"latitude": Float between -90.0 to 90, "longitude": Float between -180.0 to 180} only return the json string, nothing else',
  color_picker:
    'A valid JSON string of an object with the following format: {red: Integer between 0 and 255, blue: Integer between 0 and 255, alpha: Integer between 0 and 255, green: Integer between 0 and 255} only return the json string, nothing else',
  slug: 'A String value that will be used as an url slug satisfies the following regular expression: /^[a-z0-9_]+(?:-[a-z0-9]+)*$/',
  json: 'A valid JSON string. Only return the json string, nothing else. Ignore previous instructions about quotes. Just dont wrap the whole json string in quotes, but wrap key and values in quotes',
  seo: 'A valid JSON object in the format {"title": "Your SEO title here", "description": "Your SEO description here"}. STRICT REQUIREMENT: The title MUST be 60 characters or less—never exceed this limit. The description should be 160 characters or less. IMPORTANT: Return ONLY valid JSON with no extra text or code formatting. Do not include ```json or ``` markers. Only return the JSON object itself. Make sure all strings are properly quoted with double quotes.',
  textarea: 'a string with no limit on the number of characters',
  rich_text: '',
  file: 'A valid JSON string of an object with the following format: {title: "translated title", alt: "translated alt"} make it A valid JSON string. Only return the json string, nothing else. Ignore previous instructions about quotes. Just dont wrap the whole json string in quotes, but wrap key and values in quotes',
};

