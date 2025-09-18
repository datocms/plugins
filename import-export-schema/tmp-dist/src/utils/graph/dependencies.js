"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandSelectionWithDependencies = expandSelectionWithDependencies;
const schema_1 = require("@/utils/datocms/schema");
/**
 * Expand the current selection with all linked item types and plugins.
 */
function expandSelectionWithDependencies({ graph, seedItemTypeIds, seedPluginIds, installedPluginIds, }) {
    const initialItemIds = Array.from(new Set(seedItemTypeIds));
    const initialPluginIds = Array.from(new Set(seedPluginIds));
    const nextItemTypeIds = new Set(initialItemIds);
    const nextPluginIds = new Set(initialPluginIds);
    if (!graph) {
        return {
            itemTypeIds: nextItemTypeIds,
            pluginIds: nextPluginIds,
            addedItemTypeIds: [],
            addedPluginIds: [],
        };
    }
    const queue = [...initialItemIds];
    while (queue.length > 0) {
        const currentId = queue.pop();
        if (!currentId)
            continue;
        const node = graph.nodes.find((candidate) => candidate.id === `itemType--${currentId}`);
        if (!node || node.type !== 'itemType')
            continue;
        for (const field of node.data.fields) {
            for (const linkedId of (0, schema_1.findLinkedItemTypeIds)(field)) {
                if (!nextItemTypeIds.has(linkedId)) {
                    nextItemTypeIds.add(linkedId);
                    queue.push(linkedId);
                }
            }
            for (const pluginId of (0, schema_1.findLinkedPluginIds)(field, installedPluginIds)) {
                nextPluginIds.add(pluginId);
            }
        }
    }
    const addedItemTypeIds = Array.from(nextItemTypeIds).filter((id) => !initialItemIds.includes(id));
    const addedPluginIds = Array.from(nextPluginIds).filter((id) => !initialPluginIds.includes(id));
    return {
        itemTypeIds: nextItemTypeIds,
        pluginIds: nextPluginIds,
        addedItemTypeIds,
        addedPluginIds,
    };
}
