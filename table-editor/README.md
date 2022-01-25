# Table editor

A table editor for DatoCMS that outputs JSON string-only objects.

### Output example

```json
{
  "columns": [
    "Attributes",
    "Vue",
    "React"
  ],
  "data": [
    {
      "Attributes": "Size",
      "Vue": "The size of the Vue is about 20KB min+gzip.",
      "React": "The size of the React is about 100KB."
    },
    {
      "Attributes": "When to Use",
      "Vue": "Vue js can be used to build small web page apps that are intended to be lightweight and fast.",
      "React": "React js can be used to build community-based platforms.  Eg: marketplace and forum."
    },
    {
      "Attributes": "Platforms",
      "Vue": "It can be employed in content delivery platforms as it is fast and functions well in low-latency.",
      "React": "It can be employed in multifaceted platforms with rich mobile and web functionality."
    },
    {
      "Attributes": "Scaling",
      "Vue": "Vue offers scaling projects with advanced performance speed.",
      "React": "React offers an improved ecosystem, additional templates, and more tools."
    }
  ]
}
```