# Sidebar Todo lists

Give each record its own checklist. The plugin turns a JSON field into a to-do list in the record form, so editors can see what's still left before they publish.

![A Blog Post record whose Publishing checklist field lists four open tasks, from adding alt text to scheduling the newsletter mention, and below them two completed tasks, Pick a cover image and Proofread the article](docs/record-checklist.png)

- **Tick tasks off**: done tasks move to a completed list you can open and close.
- **Edit in place**: add, rename, reorder and delete tasks right in the field.
- **Same tasks for every record**: start new records with a ready-made checklist through the field's default value.
- **Saved with the record**: the list is plain JSON in the field, with the date each task was done.
- **No configuration**: the plugin has no settings and needs no permissions.

## Getting started

1. Install the plugin from the marketplace.
2. Go to **Schema**, open the model and add a **JSON** field, for example "Publishing checklist". Leave **Enable localization on this field?** off.
3. In the field's **Presentation** tab, under **Field editor**, click **Change** and pick **Todo list**.
4. Click **Save field**.

![The Presentation tab of the Publishing checklist field, with the Change menu of the field editor open and Todo list selected](docs/field-presentation.png)

## Using the list

An empty field shows **No tasks yet**. Click **Add task** to add the first one, then type its name.

- **Add a task**: point just below the last task and click the **+** that appears on the left, labelled **Add task**. A new row opens at the bottom.
- **Rename a task**: click its name and type.
- **Mark it done**: click the check in the **Done** column. The task moves to the completed tasks.
- **Reorder**: use the arrows in the **Order** column.
- **Delete a task**: point at its row and click the bin icon at the end.

![The bottom of the Publishing checklist, with the Add task line showing under the last task](docs/add-task.png)

Every change is part of the record, like any other field: click **Save** to keep it.

### Completed tasks

Under the list, **2 completed tasks** (with the current count) opens the done tasks. Their check is highlighted. Click it again to reopen a task: it goes back to the end of the open tasks.

## Start every record with the same tasks

Put the checklist in the field's **Default value** tab, and every new record starts with it:

```json
{
  "incomplete": [
    { "todo": "Proofread the article", "completedAt": null },
    { "todo": "Add alt text to every image", "completedAt": null },
    { "todo": "Write the meta description", "completedAt": null }
  ],
  "complete": []
}
```

When you add a new field with a default value, DatoCMS also fills it in on the existing records.

## How the value is stored

The field holds the open tasks in `incomplete` and the done ones in `complete`, each in its own order:

```json
{
  "incomplete": [
    { "id": "3f0c…", "todo": "Write the meta description", "completedAt": null }
  ],
  "complete": [
    { "id": "9a41…", "todo": "Proofread the article", "completedAt": "2026-11-15T16:05:12.000Z" }
  ]
}
```

`completedAt` is the date and time the task was ticked off. Tasks written without an `id`, like the ones in a default value, get one automatically.

## Good to know

- **Not localized, not in blocks:** the editor reads the field straight from the record, so use a non-localized field on the model itself. In a localized field or inside a block, the list always shows up empty.
- **Initial To-Dos:** earlier versions had an **Initial To-Dos** setting for this. It's no longer read; use the field's default value instead.

## Development

```bash
npm install
npm run dev     # serves the plugin at http://localhost:5173
npm run build
```

See the [DatoCMS plugin SDK documentation](https://www.datocms.com/docs/plugin-sdk) for how plugins work.
