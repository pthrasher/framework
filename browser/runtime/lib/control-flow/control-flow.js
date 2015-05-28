'use strict';

var VirtualDOM = require('./../virtual-dom/virtual-dom');
var Behaviors = require('./../behaviors/behaviors');
var ControlFlowUtils = require('./control-flow-utils');

var REPEAT_KEY = ControlFlowUtils.CONSTANTS.REPEAT_KEY;
var YIELD_KEY = ControlFlowUtils.CONSTANTS.YIELD_KEY;
var BOOLEAN_KEY = 'boolean';
var STRING_KEY = 'string';
var SELF_KEY = '$self';

function initializeSelfContainedFlows(blueprint, uid, controlFlowDataMngr) {
    var expandedBlueprint = VirtualDOM.clone(blueprint);
    initializeIfBehaviors(blueprint, expandedBlueprint, uid, controlFlowDataMngr);
    initializeRepeatBehaviors(expandedBlueprint, uid, controlFlowDataMngr);
    return expandedBlueprint;
}

function removeNodesFromExpandedBlueprint(expandedBlueprint, selector) {
    VirtualDOM.eachNode(expandedBlueprint, selector, function(node) {
        node.parentNode.removeChild(node);
    });
}

function initializeIfBehaviors(blueprint, expandedBlueprint, uid, controlFlowDataMngr) {
    var ifBehaviors = controlFlowDataMngr.getIfBehaviors();
    var behavior;
    var payload;
    for (var i = 0; i < ifBehaviors.length; i++) {
        behavior = ifBehaviors[i];
        payload = Behaviors.getPayloadFromUID(behavior, uid);

        controlFlowDataMngr.initializeDataForIfBehavior(behavior.selector, payload, blueprint);
        if (!payload) {
            // Remove node from expanded blueprint to avoid overhead of processing components
            removeNodesFromExpandedBlueprint(expandedBlueprint, behavior.selector);
        }
    }
}

function findChildRepeatSelectors(ifSelector, expandedBlueprint, controlFlowDataMngr) {
    var repeatSelectors = Object.keys(controlFlowDataMngr.getRepeatData());
    var repeatNodes = [];
    var childRepeatSelectors = [];
    var repeatNode;
    var i;
    for (i = 0; i < repeatSelectors.length; i++) {
        VirtualDOM.eachNode(expandedBlueprint, repeatSelectors[i], function(repeatNode) {
            if (repeatNodes.indexOf(repeatNode) === -1) {
                repeatNodes.push({
                    selector: repeatSelectors[i],
                    node: repeatNode
                });
            }
        });
    }
    VirtualDOM.eachNode(expandedBlueprint, ifSelector, function(ifNode) {
        for (i = 0; i < repeatNodes.length; i++) {
            repeatNode = repeatNodes[i];
            if (VirtualDOM.isDescendant(repeatNode.node, ifNode)) {
                if (childRepeatSelectors.indexOf(repeatNode.selector) === -1) {
                    childRepeatSelectors.push(repeatNode.selector);
                }
            }
        }
    });
    return childRepeatSelectors;
}

function processIfBehavior(behavior, expandedBlueprint, uid, controlFlowDataMngr) {
    var payload = Behaviors.getPayloadFromUID(behavior, uid);
    var selector = behavior.selector;
    var data = controlFlowDataMngr.getIfData()[selector];
    if (!data) {
        throw new Error('If behavior for selector: `' + selector + '` has not yet been initialized');
    }

    var oldPayload = controlFlowDataMngr.getIfPayload(selector);
    if (payload !== oldPayload) {
        applyIfBehaviorToVirtualDOM(payload, selector, expandedBlueprint, data);

        // If the payload has updated from `true` to `false`, all data associated with 'childRepeatSelectors'
        // (i.e., selectors that target nodes that are descendants of the nodes that are targeted
        // by the current '$if' behavior) needs to be reset because those behaviors will need to be re-run
        // and the parentUIDs associated with the behaviors will need to be recalculated.
        if (payload) {
            controlFlowDataMngr.resetRepeatData(
                findChildRepeatSelectors(selector, expandedBlueprint, controlFlowDataMngr)
            );
        }

        controlFlowDataMngr.setIfPayload(selector, payload);
    }
}

function verifyRepeatPayload(payload) {
    if (!(payload instanceof Array)) {
        throw new Error('Unsupported payload type for $repeat: `' + payload + '`');
    }
}

function initializeRepeatBehaviors(expandedBlueprint, uid, controlFlowDataMngr) {
    var repeatBehaviors = controlFlowDataMngr.behaviors[REPEAT_KEY];
    for (var i = 0; i < repeatBehaviors.length; i++) {
        processRepeatBehavior(repeatBehaviors[i], expandedBlueprint, uid, controlFlowDataMngr);
    }
}

function removeNodesStoredInRepeatData(data) {
    var repeatedNodes;
    for (var i = 0; i < data.parentUIDs.length; i++) {
        repeatedNodes = data.parentUIDs[i].repeatedNodes;
        for (var j = 0; j < repeatedNodes.length; j++) {
            VirtualDOM.deleteNode(repeatedNodes[i]);
        }
    }
}

function processRepeatBehavior(behavior, expandedBlueprint, uid, controlFlowDataMngr) {
    var payload = Behaviors.getPayloadFromUID(behavior, uid);
    verifyRepeatPayload(payload);
    var selector = behavior.selector;

    var repeatData = controlFlowDataMngr.getRepeatData();

    if (!repeatData[selector]) {
        controlFlowDataMngr.initializeDataForRepeatBehavior(selector, payload, expandedBlueprint);

        // Remove manually repeated (i.e., nodes that have been repeated in tree w/o applying behavior)
        // nodes from expandedBlueprint to avoid overhead of creating unnecessary component since
        // they will be overwritten by nodes that are created using behavior.
        removeNodesStoredInRepeatData(repeatData[selector]);
    }

    // Update repeat payload
    controlFlowDataMngr.setRepeatPayload(selector, payload);
    applyRepeatBehaviorToVirtualDOM(expandedBlueprint, repeatData[selector]);
}

function initializeParentDefinedFlows(expandedBlueprint, injectablesRoot, controlFlowDataMngr) {
    var childrenRoot = VirtualDOM.clone(expandedBlueprint);
    processYield(childrenRoot, injectablesRoot, controlFlowDataMngr);
    return childrenRoot;
}

function processYield(target, injectablesRoot, controlFlowDataMngr) {
    if (injectablesRoot) {
        var yieldBehaviors = controlFlowDataMngr.behaviors[YIELD_KEY];
        for (var i = 0; i < yieldBehaviors.length; i++) {
            applyYieldBehaviorToVirtualDOM(yieldBehaviors[i], target, injectablesRoot);
        }
    }
}

/*-----------------------------------------------------------------------------------------*/
// VirtualDOM manipulation
/*-----------------------------------------------------------------------------------------*/
function addDeleteMessages(expandedBlueprint, selector) {
    var targets = VirtualDOM.query(expandedBlueprint, selector);
    for (var i = 0; i < targets.length; i++) {
        ControlFlowUtils.addDeleteMessage(targets[i]);
    }
}

function applyIfBehaviorToVirtualDOM(payload, selector, expandedBlueprint, data) {
    // Add elements to expandedBlueprint
    if (payload) {
        var parentUID;
        for (parentUID in data.parentUIDs) {
            ControlFlowUtils.attachNewNode(
                data.parentUIDs[parentUID], expandedBlueprint, parentUID
            );
        }
    }
    // Remove elements from expandedBlueprint
    else {
        addDeleteMessages(expandedBlueprint, selector);
    }
}

function applyRepeatBehaviorToVirtualDOM(expandedBlueprint, data) {
    for (var payloadIndex = 0; payloadIndex < data.payloadEquality.length; payloadIndex++) {
        if (data.payloadEquality[payloadIndex]) {
            continue;
        }

        var payload = data.payload[payloadIndex];
        var parentData;
        var newNode;
        for (var parentIndex = 0; parentIndex < data.parentUIDs.length; parentIndex++) {
            parentData = data.parentUIDs[parentIndex];

            // Delete existing node since payload is different
            if (parentData.repeatedNodes[payloadIndex]) {
                ControlFlowUtils.addDeleteMessage(parentData.repeatedNodes[payloadIndex]);
                parentData.repeatedNodes[payloadIndex] = null;
            }

            // Create new node if payload exists
            // (payload equality can be false if payload is missing)
            if (payload) {
                newNode = ControlFlowUtils.attachNewNode(
                    parentData.blueprint, expandedBlueprint, parentData.uid
                );
                ControlFlowUtils.addRepeatInfo(newNode, payloadIndex, payload);
                parentData.repeatedNodes[payloadIndex] = newNode;
            }
        }
    }
    return expandedBlueprint;
}

function applyYieldBehaviorToVirtualDOM(yieldBehavior, target, injectablesRoot) {
    var selector = yieldBehavior.selector;
    var targets;
    if (selector === SELF_KEY) {
        targets = [target];
    }
    else {
        targets = VirtualDOM.query(target, selector);
    }

    var yieldValue = yieldBehavior.action();
    var injectables;
    switch (typeof yieldValue) {
        case BOOLEAN_KEY:
            injectables = yieldValue ? injectablesRoot.childNodes : [];
            break;
        case STRING_KEY:
            injectables = VirtualDOM.query(injectablesRoot, yieldValue);
            break;
        default:
            throw new Error('Unsupported payload type for $yield');
    }

    for (var i = 0; i < targets.length; i++) {
        if (injectables.length > 0) {
            VirtualDOM.removeChildNodes(targets[i]);

            for (var j = 0; j < injectables.length; j++) {
                var clone = VirtualDOM.clone(injectables[j]);
                targets[i].appendChild(clone);
            }
        }
    }
}


module.exports = {
    initializeSelfContainedFlows: initializeSelfContainedFlows,
    initializeParentDefinedFlows: initializeParentDefinedFlows,
    initializeIfBehaviors: initializeIfBehaviors,
    processIfBehavior: processIfBehavior,
    processRepeatBehavior: processRepeatBehavior,
    applyIfBehaviorToVirtualDOM: applyIfBehaviorToVirtualDOM,
    applyRepeatBehaviorToVirtualDOM: applyRepeatBehaviorToVirtualDOM,
    applyYieldBehaviorToVirtualDOM: applyYieldBehaviorToVirtualDOM
};
