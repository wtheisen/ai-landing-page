/**
 * Expert Systems Visualizer
 * Interactive graph visualization for forward and backward chaining inference
 */
(function() {
    'use strict';

    // ============================================
    // Knowledge Bases
    // ============================================
    const KNOWLEDGE_BASES = {
        animal: {
            name: 'Animal Identification',
            description: 'Identify animals based on their characteristics',
            facts: [
                // Observable facts
                { id: 'has_hair', label: 'Hair', derived: false },
                { id: 'gives_milk', label: 'Milk', derived: false },
                { id: 'has_feathers', label: 'Feathers', derived: false },
                { id: 'can_fly', label: 'Flies', derived: false },
                { id: 'lays_eggs', label: 'Eggs', derived: false },
                { id: 'eats_meat', label: 'Meat', derived: false },
                { id: 'has_pointed_teeth', label: 'Teeth', derived: false },
                { id: 'has_claws', label: 'Claws', derived: false },
                { id: 'has_forward_eyes', label: 'Fwd Eyes', derived: false },
                { id: 'has_hooves', label: 'Hooves', derived: false },
                { id: 'chews_cud', label: 'Cud', derived: false },
                { id: 'has_long_neck', label: 'Long Neck', derived: false },
                { id: 'has_long_legs', label: 'Long Legs', derived: false },
                { id: 'has_dark_spots', label: 'Spots', derived: false },
                { id: 'has_black_stripes', label: 'Stripes', derived: false },
                { id: 'has_tawny_color', label: 'Tawny', derived: false },
                { id: 'swims', label: 'Swims', derived: false },
                { id: 'is_black_white', label: 'B&W', derived: false },
                // Intermediate/derived facts
                { id: 'mammal', label: 'Mammal', derived: true },
                { id: 'bird', label: 'Bird', derived: true },
                { id: 'carnivore', label: 'Carnivore', derived: true },
                { id: 'ungulate', label: 'Ungulate', derived: true },
                // Terminal conclusions
                { id: 'cheetah', label: 'Cheetah', derived: true },
                { id: 'tiger', label: 'Tiger', derived: true },
                { id: 'giraffe', label: 'Giraffe', derived: true },
                { id: 'zebra', label: 'Zebra', derived: true },
                { id: 'ostrich', label: 'Ostrich', derived: true },
                { id: 'penguin', label: 'Penguin', derived: true },
                { id: 'albatross', label: 'Albatross', derived: true }
            ],
            rules: [
                {
                    id: 'R1',
                    name: 'Mammal (hair)',
                    conditions: [{ fact: 'has_hair', value: true }],
                    conclusions: [{ fact: 'mammal', value: true }],
                    priority: 1
                },
                {
                    id: 'R2',
                    name: 'Mammal (milk)',
                    conditions: [{ fact: 'gives_milk', value: true }],
                    conclusions: [{ fact: 'mammal', value: true }],
                    priority: 1
                },
                {
                    id: 'R3',
                    name: 'Bird (feathers)',
                    conditions: [{ fact: 'has_feathers', value: true }],
                    conclusions: [{ fact: 'bird', value: true }],
                    priority: 1
                },
                {
                    id: 'R4',
                    name: 'Bird (flies+eggs)',
                    conditions: [
                        { fact: 'can_fly', value: true },
                        { fact: 'lays_eggs', value: true }
                    ],
                    conclusions: [{ fact: 'bird', value: true }],
                    priority: 1
                },
                {
                    id: 'R5',
                    name: 'Carnivore (meat)',
                    conditions: [
                        { fact: 'mammal', value: true },
                        { fact: 'eats_meat', value: true }
                    ],
                    conclusions: [{ fact: 'carnivore', value: true }],
                    priority: 2
                },
                {
                    id: 'R6',
                    name: 'Carnivore (teeth)',
                    conditions: [
                        { fact: 'mammal', value: true },
                        { fact: 'has_pointed_teeth', value: true },
                        { fact: 'has_claws', value: true },
                        { fact: 'has_forward_eyes', value: true }
                    ],
                    conclusions: [{ fact: 'carnivore', value: true }],
                    priority: 2
                },
                {
                    id: 'R7',
                    name: 'Ungulate (hooves)',
                    conditions: [
                        { fact: 'mammal', value: true },
                        { fact: 'has_hooves', value: true }
                    ],
                    conclusions: [{ fact: 'ungulate', value: true }],
                    priority: 2
                },
                {
                    id: 'R8',
                    name: 'Ungulate (cud)',
                    conditions: [
                        { fact: 'mammal', value: true },
                        { fact: 'chews_cud', value: true }
                    ],
                    conclusions: [{ fact: 'ungulate', value: true }],
                    priority: 2
                },
                {
                    id: 'R9',
                    name: 'Cheetah',
                    conditions: [
                        { fact: 'carnivore', value: true },
                        { fact: 'has_tawny_color', value: true },
                        { fact: 'has_dark_spots', value: true }
                    ],
                    conclusions: [{ fact: 'cheetah', value: true }],
                    priority: 3
                },
                {
                    id: 'R10',
                    name: 'Tiger',
                    conditions: [
                        { fact: 'carnivore', value: true },
                        { fact: 'has_tawny_color', value: true },
                        { fact: 'has_black_stripes', value: true }
                    ],
                    conclusions: [{ fact: 'tiger', value: true }],
                    priority: 3
                },
                {
                    id: 'R11',
                    name: 'Giraffe',
                    conditions: [
                        { fact: 'ungulate', value: true },
                        { fact: 'has_long_neck', value: true },
                        { fact: 'has_long_legs', value: true },
                        { fact: 'has_dark_spots', value: true }
                    ],
                    conclusions: [{ fact: 'giraffe', value: true }],
                    priority: 3
                },
                {
                    id: 'R12',
                    name: 'Zebra',
                    conditions: [
                        { fact: 'ungulate', value: true },
                        { fact: 'has_black_stripes', value: true }
                    ],
                    conclusions: [{ fact: 'zebra', value: true }],
                    priority: 3
                },
                {
                    id: 'R13',
                    name: 'Ostrich',
                    conditions: [
                        { fact: 'bird', value: true },
                        { fact: 'has_long_neck', value: true },
                        { fact: 'has_long_legs', value: true },
                        { fact: 'can_fly', value: false }
                    ],
                    conclusions: [{ fact: 'ostrich', value: true }],
                    priority: 3
                },
                {
                    id: 'R14',
                    name: 'Penguin',
                    conditions: [
                        { fact: 'bird', value: true },
                        { fact: 'swims', value: true },
                        { fact: 'can_fly', value: false },
                        { fact: 'is_black_white', value: true }
                    ],
                    conclusions: [{ fact: 'penguin', value: true }],
                    priority: 3
                },
                {
                    id: 'R15',
                    name: 'Albatross',
                    conditions: [
                        { fact: 'bird', value: true },
                        { fact: 'can_fly', value: true }
                    ],
                    conclusions: [{ fact: 'albatross', value: true }],
                    priority: 3
                }
            ],
            goals: ['cheetah', 'tiger', 'giraffe', 'zebra', 'ostrich', 'penguin', 'albatross']
        },

        medical: {
            name: 'Medical Diagnosis',
            description: 'Simple symptom-based diagnosis',
            facts: [
                { id: 'fever', label: 'Fever', derived: false },
                { id: 'cough', label: 'Cough', derived: false },
                { id: 'runny_nose', label: 'Runny Nose', derived: false },
                { id: 'body_aches', label: 'Body Aches', derived: false },
                { id: 'sore_throat', label: 'Sore Throat', derived: false },
                { id: 'fatigue', label: 'Fatigue', derived: false },
                { id: 'sneezing', label: 'Sneezing', derived: false },
                { id: 'chills', label: 'Chills', derived: false },
                { id: 'chest_pain', label: 'Chest Pain', derived: false },
                { id: 'loss_taste', label: 'No Taste', derived: false },
                { id: 'cold', label: 'Cold', derived: true },
                { id: 'flu', label: 'Flu', derived: true },
                { id: 'allergy', label: 'Allergy', derived: true },
                { id: 'covid', label: 'COVID-19', derived: true },
                { id: 'bronchitis', label: 'Bronchitis', derived: true }
            ],
            rules: [
                {
                    id: 'R1',
                    name: 'Common Cold',
                    conditions: [
                        { fact: 'runny_nose', value: true },
                        { fact: 'sore_throat', value: true },
                        { fact: 'sneezing', value: true }
                    ],
                    conclusions: [{ fact: 'cold', value: true }],
                    priority: 1
                },
                {
                    id: 'R2',
                    name: 'Influenza',
                    conditions: [
                        { fact: 'fever', value: true },
                        { fact: 'body_aches', value: true },
                        { fact: 'fatigue', value: true },
                        { fact: 'chills', value: true }
                    ],
                    conclusions: [{ fact: 'flu', value: true }],
                    priority: 1
                },
                {
                    id: 'R3',
                    name: 'Allergies',
                    conditions: [
                        { fact: 'sneezing', value: true },
                        { fact: 'runny_nose', value: true },
                        { fact: 'fever', value: false }
                    ],
                    conclusions: [{ fact: 'allergy', value: true }],
                    priority: 1
                },
                {
                    id: 'R4',
                    name: 'COVID-19',
                    conditions: [
                        { fact: 'fever', value: true },
                        { fact: 'cough', value: true },
                        { fact: 'loss_taste', value: true }
                    ],
                    conclusions: [{ fact: 'covid', value: true }],
                    priority: 1
                },
                {
                    id: 'R5',
                    name: 'Bronchitis',
                    conditions: [
                        { fact: 'cough', value: true },
                        { fact: 'chest_pain', value: true },
                        { fact: 'fatigue', value: true }
                    ],
                    conclusions: [{ fact: 'bronchitis', value: true }],
                    priority: 1
                }
            ],
            goals: ['cold', 'flu', 'allergy', 'covid', 'bronchitis']
        },

        troubleshoot: {
            name: 'Computer Troubleshooting',
            description: 'Diagnose common computer problems',
            facts: [
                { id: 'power_on', label: 'Power On', derived: false },
                { id: 'screen_on', label: 'Screen On', derived: false },
                { id: 'beeps', label: 'Beeps', derived: false },
                { id: 'fan_running', label: 'Fan', derived: false },
                { id: 'os_loads', label: 'OS Loads', derived: false },
                { id: 'overheating', label: 'Hot', derived: false },
                { id: 'random_shutdowns', label: 'Shutdowns', derived: false },
                { id: 'blue_screen', label: 'BSOD', derived: false },
                { id: 'clicking_sound', label: 'Clicking', derived: false },
                { id: 'slow_performance', label: 'Slow', derived: false },
                { id: 'power_issue', label: 'PSU Issue', derived: true },
                { id: 'display_issue', label: 'Display Issue', derived: true },
                { id: 'memory_issue', label: 'RAM Issue', derived: true },
                { id: 'os_issue', label: 'OS Issue', derived: true },
                { id: 'cooling_issue', label: 'Cooling Issue', derived: true },
                { id: 'hard_drive_issue', label: 'HDD Issue', derived: true }
            ],
            rules: [
                {
                    id: 'R1',
                    name: 'Power Supply',
                    conditions: [{ fact: 'power_on', value: false }],
                    conclusions: [{ fact: 'power_issue', value: true }],
                    priority: 1
                },
                {
                    id: 'R2',
                    name: 'Display',
                    conditions: [
                        { fact: 'power_on', value: true },
                        { fact: 'screen_on', value: false },
                        { fact: 'fan_running', value: true }
                    ],
                    conclusions: [{ fact: 'display_issue', value: true }],
                    priority: 2
                },
                {
                    id: 'R3',
                    name: 'Memory (beeps)',
                    conditions: [
                        { fact: 'power_on', value: true },
                        { fact: 'beeps', value: true },
                        { fact: 'screen_on', value: false }
                    ],
                    conclusions: [{ fact: 'memory_issue', value: true }],
                    priority: 2
                },
                {
                    id: 'R4',
                    name: 'OS Problem',
                    conditions: [
                        { fact: 'power_on', value: true },
                        { fact: 'screen_on', value: true },
                        { fact: 'os_loads', value: false }
                    ],
                    conclusions: [{ fact: 'os_issue', value: true }],
                    priority: 2
                },
                {
                    id: 'R5',
                    name: 'Cooling',
                    conditions: [
                        { fact: 'overheating', value: true },
                        { fact: 'random_shutdowns', value: true }
                    ],
                    conclusions: [{ fact: 'cooling_issue', value: true }],
                    priority: 1
                },
                {
                    id: 'R6',
                    name: 'Hard Drive',
                    conditions: [
                        { fact: 'clicking_sound', value: true },
                        { fact: 'slow_performance', value: true }
                    ],
                    conclusions: [{ fact: 'hard_drive_issue', value: true }],
                    priority: 1
                },
                {
                    id: 'R7',
                    name: 'Memory (BSOD)',
                    conditions: [
                        { fact: 'blue_screen', value: true },
                        { fact: 'random_shutdowns', value: true }
                    ],
                    conclusions: [{ fact: 'memory_issue', value: true }],
                    priority: 1
                }
            ],
            goals: ['power_issue', 'display_issue', 'memory_issue', 'os_issue', 'cooling_issue', 'hard_drive_issue']
        }
    };

    // ============================================
    // Step Types
    // ============================================
    const STEP_TYPES = {
        FC_INIT: 'FC_INIT',
        FC_EVALUATE_RULE: 'FC_EVALUATE_RULE',
        FC_RULE_MATCHES: 'FC_RULE_MATCHES',
        FC_RULE_FAILS: 'FC_RULE_FAILS',
        FC_FIRE_RULE: 'FC_FIRE_RULE',
        FC_COMPLETE: 'FC_COMPLETE',
        BC_SET_GOAL: 'BC_SET_GOAL',
        BC_CHECK_KNOWN: 'BC_CHECK_KNOWN',
        BC_FIND_RULE: 'BC_FIND_RULE',
        BC_TRY_RULE: 'BC_TRY_RULE',
        BC_PROVE_CONDITION: 'BC_PROVE_CONDITION',
        BC_CONDITION_KNOWN: 'BC_CONDITION_KNOWN',
        BC_CONDITION_DERIVED: 'BC_CONDITION_DERIVED',
        BC_CONDITION_FAIL: 'BC_CONDITION_FAIL',
        BC_RULE_SUCCESS: 'BC_RULE_SUCCESS',
        BC_RULE_FAIL: 'BC_RULE_FAIL',
        BC_ASK_USER: 'BC_ASK_USER',
        BC_GOAL_PROVEN: 'BC_GOAL_PROVEN',
        BC_GOAL_FAILED: 'BC_GOAL_FAILED'
    };

    // ============================================
    // Theme Colors
    // ============================================
    function getColors() {
        const style = getComputedStyle(document.documentElement);
        const get = (prop) => style.getPropertyValue(prop).trim() || null;

        return {
            canvasBg: get('--viz-canvas-bg') || '#fafafa',
            // Fact node colors
            factUnknown: get('--viz-border') || '#dee2e6',
            factTrue: get('--expert-fact-true-border') || '#28a745',
            factFalse: get('--expert-fact-false-border') || '#dc3545',
            factDerived: get('--expert-fact-derived-border') || '#4caf50',
            factNeeded: get('--expert-fact-unknown-border') || '#ff9800',
            factBg: EAIColor('surface'),
            // Rule node colors
            ruleBg: get('--expert-rule-bg') || '#f8f9fa',
            ruleBorder: get('--expert-rule-border') || '#dee2e6',
            ruleEvaluating: get('--expert-rule-evaluating-border') || '#ffc107',
            ruleFired: get('--expert-rule-fired-border') || '#28a745',
            ruleFailed: get('--expert-rule-failed-border') || '#dc3545',
            // Edge colors
            edgeDefault: get('--viz-border') || '#dee2e6',
            edgeActive: get('--expert-edge-active') || '#ffc107',
            edgeFired: get('--expert-edge-fired') || '#28a745',
            // Text
            text: get('--viz-text') || '#333333',
            textMuted: get('--viz-text-muted') || '#6c757d',
            textLight: EAIColor('surface')
        };
    }

    // ============================================
    // Inference Engine
    // ============================================
    class InferenceEngine {
        constructor(kb) {
            this.kb = kb;
            this.workingMemory = new Map();
            this.firedRules = new Set();
            this.derivedFacts = new Set();
            this.neededFacts = new Set(); // Facts needed but unknown (for BC)
            this.derivationInfo = new Map(); // Tracks how each fact was derived: factId -> {rule, conditions}
            this.steps = [];
        }

        reset() {
            this.workingMemory.clear();
            this.firedRules.clear();
            this.derivedFacts.clear();
            this.neededFacts.clear();
            this.derivationInfo.clear();
            this.steps = [];
        }

        setFact(factId, value) {
            this.workingMemory.set(factId, value);
        }

        getSnapshot() {
            return {
                workingMemory: new Map(this.workingMemory),
                firedRules: new Set(this.firedRules),
                derivedFacts: new Set(this.derivedFacts),
                neededFacts: new Set(this.neededFacts),
                derivationInfo: new Map(this.derivationInfo)
            };
        }

        evaluateConditions(conditions) {
            for (const cond of conditions) {
                if (!this.workingMemory.has(cond.fact)) return { success: false, reason: 'unknown', cond };
                if (this.workingMemory.get(cond.fact) !== cond.value) return { success: false, reason: 'mismatch', cond };
            }
            return { success: true };
        }

        runForwardChaining() {
            this.steps = [];
            this.firedRules.clear();
            this.derivedFacts.clear();

            const initialFacts = [];
            for (const [id, val] of this.workingMemory) {
                const def = this.kb.facts.find(f => f.id === id);
                if (def && !def.derived) initialFacts.push({ id, value: val, label: def.label });
            }

            this.steps.push({
                type: STEP_TYPES.FC_INIT,
                initialFacts,
                ...this.getSnapshot(),
                message: initialFacts.length ? `Starting with ${initialFacts.length} fact(s)` : 'No initial facts'
            });

            let changed = true;
            let cycles = 0;

            while (changed && cycles < 50) {
                changed = false;
                cycles++;

                for (const rule of this.kb.rules) {
                    if (this.firedRules.has(rule.id)) continue;

                    this.steps.push({
                        type: STEP_TYPES.FC_EVALUATE_RULE,
                        rule,
                        ...this.getSnapshot(),
                        message: `Checking ${rule.id}: ${rule.name}`
                    });

                    const result = this.evaluateConditions(rule.conditions);

                    if (result.success) {
                        this.steps.push({
                            type: STEP_TYPES.FC_RULE_MATCHES,
                            rule,
                            ...this.getSnapshot(),
                            message: `${rule.id} matches!`
                        });

                        this.firedRules.add(rule.id);
                        changed = true;

                        for (const concl of rule.conclusions) {
                            this.workingMemory.set(concl.fact, concl.value);
                            this.derivedFacts.add(concl.fact);

                            // Record derivation info
                            this.derivationInfo.set(concl.fact, {
                                rule: rule,
                                conditions: rule.conditions.map(c => ({
                                    fact: c.fact,
                                    value: c.value,
                                    actualValue: this.workingMemory.get(c.fact)
                                }))
                            });

                            const def = this.kb.facts.find(f => f.id === concl.fact);

                            this.steps.push({
                                type: STEP_TYPES.FC_FIRE_RULE,
                                rule,
                                conclusion: concl,
                                factLabel: def ? def.label : concl.fact,
                                ...this.getSnapshot(),
                                message: `${rule.id} fires: ${def ? def.label : concl.fact} = ${concl.value}`
                            });
                        }
                    } else {
                        this.steps.push({
                            type: STEP_TYPES.FC_RULE_FAILS,
                            rule,
                            failedCondition: result.cond,
                            reason: result.reason,
                            ...this.getSnapshot(),
                            message: `${rule.id} fails: ${result.cond.fact} ${result.reason === 'unknown' ? 'unknown' : 'mismatch'}`
                        });
                    }
                }
            }

            const conclusions = this.kb.goals.filter(g => this.workingMemory.get(g) === true)
                .map(g => {
                    const def = this.kb.facts.find(f => f.id === g);
                    return { id: g, label: def ? def.label : g };
                });

            this.steps.push({
                type: STEP_TYPES.FC_COMPLETE,
                conclusions,
                ...this.getSnapshot(),
                message: conclusions.length ? `Done: ${conclusions.map(c => c.label).join(', ')}` : 'No conclusions'
            });

            return this.steps;
        }

        runBackwardChaining(goalId) {
            this.steps = [];
            this.firedRules.clear();
            this.derivedFacts.clear();
            this.neededFacts.clear();

            const goalDef = this.kb.facts.find(f => f.id === goalId);

            this.steps.push({
                type: STEP_TYPES.BC_SET_GOAL,
                goal: goalId,
                goalLabel: goalDef ? goalDef.label : goalId,
                ...this.getSnapshot(),
                message: `Goal: prove ${goalDef ? goalDef.label : goalId}`
            });

            const result = this.proveGoal(goalId, new Set());

            this.steps.push({
                type: result ? STEP_TYPES.BC_GOAL_PROVEN : STEP_TYPES.BC_GOAL_FAILED,
                goal: goalId,
                goalLabel: goalDef ? goalDef.label : goalId,
                ...this.getSnapshot(),
                message: result ? `Proven: ${goalDef ? goalDef.label : goalId}` : `Cannot prove ${goalDef ? goalDef.label : goalId}`
            });

            return this.steps;
        }

        proveGoal(goalId, visited) {
            if (visited.has(goalId)) return false;
            visited.add(goalId);

            const def = this.kb.facts.find(f => f.id === goalId);
            const label = def ? def.label : goalId;

            if (this.workingMemory.has(goalId)) {
                const val = this.workingMemory.get(goalId);
                this.steps.push({
                    type: STEP_TYPES.BC_CHECK_KNOWN,
                    fact: goalId,
                    factLabel: label,
                    value: val,
                    ...this.getSnapshot(),
                    message: `${label} known: ${val}`
                });
                return val === true;
            }

            const rules = this.kb.rules.filter(r => r.conclusions.some(c => c.fact === goalId && c.value === true));

            if (rules.length === 0) {
                if (def && !def.derived) {
                    this.neededFacts.add(goalId);
                    this.steps.push({
                        type: STEP_TYPES.BC_ASK_USER,
                        fact: goalId,
                        factLabel: label,
                        ...this.getSnapshot(),
                        message: `Missing fact: ${label} (unknown)`
                    });
                }
                return false;
            }

            this.steps.push({
                type: STEP_TYPES.BC_FIND_RULE,
                goal: goalId,
                goalLabel: label,
                rules: rules.map(r => r.id),
                ...this.getSnapshot(),
                message: `Found ${rules.length} rule(s) for ${label}`
            });

            for (const rule of rules) {
                this.steps.push({
                    type: STEP_TYPES.BC_TRY_RULE,
                    rule,
                    goal: goalId,
                    ...this.getSnapshot(),
                    message: `Trying ${rule.id}`
                });

                let allOk = true;

                for (const cond of rule.conditions) {
                    const cDef = this.kb.facts.find(f => f.id === cond.fact);
                    const cLabel = cDef ? cDef.label : cond.fact;

                    this.steps.push({
                        type: STEP_TYPES.BC_PROVE_CONDITION,
                        condition: cond,
                        conditionLabel: cLabel,
                        rule,
                        ...this.getSnapshot(),
                        message: `Need: ${cLabel}=${cond.value}`
                    });

                    if (this.workingMemory.has(cond.fact)) {
                        const known = this.workingMemory.get(cond.fact);
                        if (known === cond.value) {
                            this.steps.push({
                                type: STEP_TYPES.BC_CONDITION_KNOWN,
                                condition: cond,
                                conditionLabel: cLabel,
                                ...this.getSnapshot(),
                                message: `${cLabel}=${known} OK`
                            });
                            continue;
                        } else {
                            this.steps.push({
                                type: STEP_TYPES.BC_CONDITION_FAIL,
                                condition: cond,
                                conditionLabel: cLabel,
                                ...this.getSnapshot(),
                                message: `${cLabel}=${known}, need ${cond.value}`
                            });
                            allOk = false;
                            break;
                        }
                    }

                    if (cond.value === true) {
                        if (this.proveGoal(cond.fact, new Set(visited))) {
                            this.workingMemory.set(cond.fact, true);
                            this.derivedFacts.add(cond.fact);
                            this.steps.push({
                                type: STEP_TYPES.BC_CONDITION_DERIVED,
                                condition: cond,
                                conditionLabel: cLabel,
                                ...this.getSnapshot(),
                                message: `Proved ${cLabel}`
                            });
                        } else {
                            this.steps.push({
                                type: STEP_TYPES.BC_CONDITION_FAIL,
                                condition: cond,
                                conditionLabel: cLabel,
                                ...this.getSnapshot(),
                                message: `Cannot prove ${cLabel}`
                            });
                            allOk = false;
                            break;
                        }
                    } else {
                        this.steps.push({
                            type: STEP_TYPES.BC_CONDITION_FAIL,
                            condition: cond,
                            conditionLabel: cLabel,
                            ...this.getSnapshot(),
                            message: `${cLabel} unknown`
                        });
                        allOk = false;
                        break;
                    }
                }

                if (allOk) {
                    this.firedRules.add(rule.id);
                    this.workingMemory.set(goalId, true);
                    this.derivedFacts.add(goalId);

                    // Record derivation info
                    this.derivationInfo.set(goalId, {
                        rule: rule,
                        conditions: rule.conditions.map(c => ({
                            fact: c.fact,
                            value: c.value,
                            actualValue: this.workingMemory.get(c.fact)
                        }))
                    });

                    this.steps.push({
                        type: STEP_TYPES.BC_RULE_SUCCESS,
                        rule,
                        goal: goalId,
                        ...this.getSnapshot(),
                        message: `${rule.id} succeeds!`
                    });
                    return true;
                } else {
                    this.steps.push({
                        type: STEP_TYPES.BC_RULE_FAIL,
                        rule,
                        goal: goalId,
                        ...this.getSnapshot(),
                        message: `${rule.id} fails`
                    });
                }
            }

            return false;
        }
    }

    // ============================================
    // Graph Layout Engine (DAG)
    // ============================================
    class GraphLayout {
        constructor(kb) {
            this.kb = kb;
            this.factNodes = new Map();
            this.ruleNodes = new Map();
            this.edges = [];
        }

        compute(canvasWidth, canvasHeight) {
            this.factNodes.clear();
            this.ruleNodes.clear();
            this.edges = [];

            const padding = 40;
            const baseFactRadius = 22;
            const ruleWidth = 50;
            const ruleHeight = 24;
            const minSpacing = 65; // Minimum horizontal spacing between nodes

            // Determine fact levels based on derivation depth
            const factLevels = new Map();
            const rules = this.kb.rules;
            const facts = this.kb.facts;

            // Level 0: observable facts
            facts.forEach(f => {
                if (!f.derived) factLevels.set(f.id, 0);
            });

            // Compute levels for derived facts
            let changed = true;
            while (changed) {
                changed = false;
                for (const rule of rules) {
                    const condLevels = rule.conditions.map(c => factLevels.get(c.fact) ?? -1);
                    if (condLevels.some(l => l < 0)) continue;
                    const maxCondLevel = Math.max(...condLevels);

                    for (const concl of rule.conclusions) {
                        const newLevel = maxCondLevel + 1;
                        if (!factLevels.has(concl.fact) || factLevels.get(concl.fact) < newLevel) {
                            factLevels.set(concl.fact, newLevel);
                            changed = true;
                        }
                    }
                }
            }

            // Assign level to facts that weren't reached
            facts.forEach(f => {
                if (!factLevels.has(f.id)) factLevels.set(f.id, 0);
            });

            // Group facts by level
            const levelGroups = new Map();
            for (const [factId, level] of factLevels) {
                if (!levelGroups.has(level)) levelGroups.set(level, []);
                levelGroups.get(level).push(factId);
            }

            const maxLevel = Math.max(...levelGroups.keys());

            // Calculate required width based on widest level
            const maxNodesInLevel = Math.max(...[...levelGroups.values()].map(g => g.length));
            const requiredWidth = Math.max(canvasWidth, maxNodesInLevel * minSpacing + padding * 2);

            // Store the computed width for the visualizer to use
            this.computedWidth = requiredWidth;

            const levelHeight = (canvasHeight - padding * 2) / (maxLevel + 1);

            // Position fact nodes with minimum spacing
            for (const [level, factIds] of levelGroups) {
                const y = padding + level * levelHeight + levelHeight / 2;
                const nodeCount = factIds.length;

                // Use minimum spacing, center the group
                const groupWidth = (nodeCount - 1) * minSpacing;
                const startX = (requiredWidth - groupWidth) / 2;

                // Adjust radius for crowded levels
                const factRadius = nodeCount > 10 ? 18 : baseFactRadius;

                factIds.forEach((factId, i) => {
                    const x = startX + i * minSpacing;
                    const def = facts.find(f => f.id === factId);
                    this.factNodes.set(factId, {
                        id: factId,
                        x,
                        y,
                        radius: factRadius,
                        label: def ? def.label : factId,
                        derived: def ? def.derived : false
                    });
                });
            }

            // Position rule nodes between their conditions and conclusions
            rules.forEach((rule, idx) => {
                const condPositions = rule.conditions.map(c => this.factNodes.get(c.fact)).filter(Boolean);
                const conclPositions = rule.conclusions.map(c => this.factNodes.get(c.fact)).filter(Boolean);

                if (condPositions.length === 0 || conclPositions.length === 0) return;

                const condAvgX = condPositions.reduce((s, p) => s + p.x, 0) / condPositions.length;
                const condMaxY = Math.max(...condPositions.map(p => p.y));
                const conclAvgY = Math.min(...conclPositions.map(p => p.y));

                const x = condAvgX;
                const y = (condMaxY + conclAvgY) / 2;

                this.ruleNodes.set(rule.id, {
                    id: rule.id,
                    x,
                    y,
                    width: ruleWidth,
                    height: ruleHeight,
                    label: rule.id,
                    rule
                });

                // Create edges: conditions -> rule
                for (const cond of rule.conditions) {
                    const factNode = this.factNodes.get(cond.fact);
                    if (factNode) {
                        this.edges.push({
                            from: { type: 'fact', id: cond.fact },
                            to: { type: 'rule', id: rule.id },
                            condition: cond
                        });
                    }
                }

                // Create edges: rule -> conclusions
                for (const concl of rule.conclusions) {
                    const factNode = this.factNodes.get(concl.fact);
                    if (factNode) {
                        this.edges.push({
                            from: { type: 'rule', id: rule.id },
                            to: { type: 'fact', id: concl.fact },
                            conclusion: concl
                        });
                    }
                }
            });
        }

        getNodePosition(type, id) {
            if (type === 'fact') {
                const node = this.factNodes.get(id);
                return node ? { x: node.x, y: node.y } : null;
            } else {
                const node = this.ruleNodes.get(id);
                return node ? { x: node.x, y: node.y } : null;
            }
        }
    }

    // ============================================
    // Visualizer
    // ============================================
    class ExpertSystemVisualizer {
        constructor(canvasId) {
            this.canvas = document.getElementById(canvasId);
            this.ctx = this.canvas.getContext('2d');

            this.dpr = window.devicePixelRatio || 1;
            this.setupCanvas();

            this.kb = null;
            this.engine = null;
            this.layout = null;
            this.mode = 'forward';
            this.selectedGoal = null;

            this.currentStep = null;
            this.stepIndex = -1;
            this.steps = [];
            this.playback = null;

            this.colors = getColors();

            // Tooltip state
            this.tooltip = null;
            this.selectedFact = null;

            this.setupEventListeners();
            this.loadKnowledgeBase('animal');
        }

        setupCanvas() {
            const w = this.canvas.width;
            const h = this.canvas.height;

            this.canvas.width = w * this.dpr;
            this.canvas.height = h * this.dpr;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';

            this.displayWidth = w;
            this.displayHeight = h;

            this.ctx.scale(this.dpr, this.dpr);
        }

        setupEventListeners() {
            document.getElementById('kb-select')?.addEventListener('change', e => this.loadKnowledgeBase(e.target.value));

            document.querySelectorAll('.mode-toggle .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.mode-toggle .btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.mode = btn.dataset.mode;
                    this.updateModeUI();
                    this.resetPlayback();
                });
            });

            document.getElementById('goal-select')?.addEventListener('change', e => {
                this.selectedGoal = e.target.value || null;
                this.resetPlayback();
            });

            document.getElementById('btn-run')?.addEventListener('click', () => this.runInference());
            document.getElementById('btn-pause')?.addEventListener('click', () => this.pausePlayback());
            document.getElementById('btn-step')?.addEventListener('click', () => this.stepForward());
            document.getElementById('btn-step-back')?.addEventListener('click', () => this.stepBackward());
            document.getElementById('btn-reset')?.addEventListener('click', () => this.resetPlayback());

            document.getElementById('speed-slider')?.addEventListener('input', e => {
                if (this.playback) this.playback.setSpeed(parseInt(e.target.value));
            });

            const factSelect = document.getElementById('fact-select');
            const factToggle = document.getElementById('fact-value-toggle');

            factSelect?.addEventListener('change', e => {
                if (e.target.value && factToggle) {
                    factToggle.style.display = 'flex';
                    factToggle.dataset.factId = e.target.value;
                }
            });

            factToggle?.querySelectorAll('.btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const factId = factToggle.dataset.factId;
                    if (factId) {
                        this.addFact(factId, btn.dataset.value === 'true');
                        factSelect.value = '';
                        factToggle.style.display = 'none';
                    }
                });
            });

            document.getElementById('btn-clear-facts')?.addEventListener('click', () => this.clearFacts());

            document.addEventListener('themechange', () => {
                this.colors = getColors();
                this.render();
            });

            document.querySelectorAll('.info-panel-tabs .btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.info-panel-tabs .btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.info-tab-content').forEach(c => c.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
                });
            });

            // Canvas click handler for fact derivation info
            this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));

            // Hide tooltip when clicking elsewhere
            document.addEventListener('click', (e) => {
                if (this.tooltip && !this.tooltip.contains(e.target) && e.target !== this.canvas) {
                    this.hideTooltip();
                }
            });
        }

        handleCanvasClick(e) {
            const rect = this.canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (this.displayWidth / rect.width);
            const y = (e.clientY - rect.top) * (this.displayHeight / rect.height);

            // Check if click is on a fact node
            const clickedFact = this.getFactAtPosition(x, y);

            if (clickedFact) {
                this.showFactTooltip(clickedFact, e.clientX, e.clientY);
            } else {
                this.hideTooltip();
            }
        }

        getFactAtPosition(x, y) {
            if (!this.layout) return null;

            for (const [factId, node] of this.layout.factNodes) {
                const dx = x - node.x;
                const dy = y - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist <= node.radius) {
                    return { factId, node };
                }
            }
            return null;
        }

        showFactTooltip(clickedFact, clientX, clientY) {
            const { factId, node } = clickedFact;
            const factDef = this.kb?.facts.find(f => f.id === factId);
            const derivationInfo = this.currentStep?.derivationInfo || this.engine?.derivationInfo || new Map();
            const wm = this.currentStep?.workingMemory || this.engine?.workingMemory || new Map();
            const derivedFacts = this.currentStep?.derivedFacts || this.engine?.derivedFacts || new Set();

            // Build tooltip content
            let content = `<div class="derivation-tooltip-header">${factDef ? factDef.label : factId}</div>`;

            if (wm.has(factId)) {
                const value = wm.get(factId);
                content += `<div class="derivation-tooltip-value">Value: <strong>${value ? 'TRUE' : 'FALSE'}</strong></div>`;

                if (derivedFacts.has(factId) && derivationInfo.has(factId)) {
                    const info = derivationInfo.get(factId);
                    content += `<div class="derivation-tooltip-rule">Derived by: <strong>${info.rule.id}</strong> (${info.rule.name})</div>`;
                    content += `<div class="derivation-tooltip-conditions">Conditions:</div>`;
                    content += '<ul class="derivation-tooltip-list">';
                    for (const cond of info.conditions) {
                        const cDef = this.kb?.facts.find(f => f.id === cond.fact);
                        const icon = cond.actualValue === cond.value ? '✓' : '✗';
                        content += `<li><span class="cond-icon ${cond.actualValue === cond.value ? 'ok' : 'fail'}">${icon}</span> ${cDef ? cDef.label : cond.fact} = ${cond.value}</li>`;
                    }
                    content += '</ul>';
                } else if (!factDef?.derived) {
                    content += `<div class="derivation-tooltip-source">Set by user</div>`;
                }
            } else {
                content += `<div class="derivation-tooltip-value">Value: <em>Unknown</em></div>`;
            }

            this.hideTooltip();

            // Create tooltip element
            this.tooltip = document.createElement('div');
            this.tooltip.className = 'derivation-tooltip';
            this.tooltip.innerHTML = content;
            document.body.appendChild(this.tooltip);

            // Position tooltip
            const tooltipRect = this.tooltip.getBoundingClientRect();
            let left = clientX + 10;
            let top = clientY + 10;

            // Keep tooltip in viewport
            if (left + tooltipRect.width > window.innerWidth) {
                left = clientX - tooltipRect.width - 10;
            }
            if (top + tooltipRect.height > window.innerHeight) {
                top = clientY - tooltipRect.height - 10;
            }

            this.tooltip.style.left = left + 'px';
            this.tooltip.style.top = top + 'px';

            this.selectedFact = factId;
            this.render(); // Re-render to highlight selected fact
        }

        hideTooltip() {
            if (this.tooltip) {
                this.tooltip.remove();
                this.tooltip = null;
            }
            if (this.selectedFact) {
                this.selectedFact = null;
                this.render(); // Re-render to remove highlight
            }
        }

        getDerivationPath(factId, derivationInfo, visited = new Set()) {
            const path = { facts: new Set(), rules: new Set() };

            if (visited.has(factId)) return path;
            visited.add(factId);

            path.facts.add(factId);

            if (derivationInfo.has(factId)) {
                const info = derivationInfo.get(factId);
                path.rules.add(info.rule.id);

                // Recursively add conditions
                for (const cond of info.conditions) {
                    path.facts.add(cond.fact);
                    const subPath = this.getDerivationPath(cond.fact, derivationInfo, visited);
                    subPath.facts.forEach(f => path.facts.add(f));
                    subPath.rules.forEach(r => path.rules.add(r));
                }
            }

            return path;
        }

        loadKnowledgeBase(kbId) {
            this.kb = KNOWLEDGE_BASES[kbId];
            if (!this.kb) return;

            this.engine = new InferenceEngine(this.kb);
            this.layout = new GraphLayout(this.kb);
            this.layout.compute(this.displayWidth, this.displayHeight);

            // Resize canvas if layout needs more width
            if (this.layout.computedWidth > this.displayWidth) {
                this.resizeCanvas(this.layout.computedWidth, this.displayHeight);
            } else if (this.displayWidth !== this.canvas.width / this.dpr) {
                // Reset to default width if switching to a smaller KB
                this.resizeCanvas(700, this.displayHeight);
                this.layout.compute(this.displayWidth, this.displayHeight);
            }

            this.resetPlayback();
            this.updateFactSelect();
            this.updateGoalSelect();
            this.updateRulesList();
            this.updateFactsDisplay();
            this.render();
        }

        resizeCanvas(width, height) {
            this.displayWidth = width;
            this.displayHeight = height;

            this.canvas.width = width * this.dpr;
            this.canvas.height = height * this.dpr;
            this.canvas.style.width = width + 'px';
            this.canvas.style.height = height + 'px';

            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.scale(this.dpr, this.dpr);
        }

        updateFactSelect() {
            const select = document.getElementById('fact-select');
            if (!select || !this.kb) return;
            select.innerHTML = '<option value="">+ Add Fact...</option>';
            this.kb.facts.filter(f => !f.derived).forEach(f => {
                const opt = document.createElement('option');
                opt.value = f.id;
                opt.textContent = f.label;
                select.appendChild(opt);
            });
        }

        updateGoalSelect() {
            const select = document.getElementById('goal-select');
            if (!select || !this.kb) return;
            select.innerHTML = '<option value="">Select Goal...</option>';
            this.kb.goals.forEach(g => {
                const def = this.kb.facts.find(f => f.id === g);
                const opt = document.createElement('option');
                opt.value = g;
                opt.textContent = def ? def.label : g;
                select.appendChild(opt);
            });
            this.selectedGoal = null;
        }

        updateRulesList() {
            const container = document.getElementById('rules-list');
            if (!container || !this.kb) return;
            container.innerHTML = '';

            this.kb.rules.forEach(rule => {
                const item = document.createElement('div');
                item.className = 'rule-item';
                item.id = `rule-item-${rule.id}`;

                const conds = rule.conditions.map(c => {
                    const d = this.kb.facts.find(f => f.id === c.fact);
                    return `<span class="rule-fact">${d ? d.label : c.fact}</span>`;
                }).join(' <span class="rule-keyword">&</span> ');

                const concls = rule.conclusions.map(c => {
                    const d = this.kb.facts.find(f => f.id === c.fact);
                    return `<span class="rule-fact">${d ? d.label : c.fact}</span>`;
                }).join(', ');

                item.innerHTML = `
                    <div class="rule-item-header">
                        <div class="rule-item-left">
                            <span class="rule-item-id">${rule.id}</span>
                            <span class="rule-priority-badge" title="Priority ${rule.priority}">P${rule.priority}</span>
                            <span class="rule-status-icon" data-rule-id="${rule.id}"></span>
                        </div>
                        <span class="rule-item-name">${rule.name}</span>
                    </div>
                    <div class="rule-item-body">${conds} → ${concls}</div>
                `;
                container.appendChild(item);
            });
        }

        updateFactsDisplay() {
            const container = document.getElementById('facts-container');
            if (!container) return;
            container.innerHTML = '';

            // Get needed facts from current step or engine
            const neededFacts = this.currentStep?.neededFacts || this.engine?.neededFacts || new Set();

            if (!this.engine || (this.engine.workingMemory.size === 0 && neededFacts.size === 0)) {
                container.innerHTML = '<span class="text-muted no-facts-msg">No facts set. Add facts below.</span>';
                return;
            }

            // Show known facts
            for (const [factId, value] of this.engine.workingMemory) {
                const def = this.kb?.facts.find(f => f.id === factId);
                const isDerived = def?.derived || this.engine.derivedFacts.has(factId);

                const badge = document.createElement('span');
                badge.className = `fact-badge ${value ? 'true' : 'false'} ${isDerived ? 'derived' : ''}`;
                badge.innerHTML = `
                    <span class="fact-label">${def ? def.label : factId}</span>
                    <span class="fact-value">=${value ? 'T' : 'F'}</span>
                    ${!isDerived ? '<span class="fact-remove"><i class="fa fa-times"></i></span>' : ''}
                `;

                if (!isDerived) {
                    badge.addEventListener('click', () => this.removeFact(factId));
                }
                container.appendChild(badge);
            }

            // Show needed/unknown facts (from backward chaining)
            for (const factId of neededFacts) {
                if (this.engine.workingMemory.has(factId)) continue; // Skip if already known
                const def = this.kb?.facts.find(f => f.id === factId);

                const badge = document.createElement('span');
                badge.className = 'fact-badge unknown';
                badge.innerHTML = `
                    <span class="fact-label">${def ? def.label : factId}</span>
                    <span class="fact-value">=?</span>
                `;
                badge.title = 'This fact is needed but unknown';
                container.appendChild(badge);
            }
        }

        addFact(factId, value) {
            if (!this.engine) return;
            this.engine.setFact(factId, value);
            this.updateFactsDisplay();
            this.resetPlayback();
            this.render();
        }

        removeFact(factId) {
            if (!this.engine) return;
            this.engine.workingMemory.delete(factId);
            this.updateFactsDisplay();
            this.resetPlayback();
            this.render();
        }

        clearFacts() {
            if (!this.engine) return;
            this.engine.reset();
            this.updateFactsDisplay();
            this.resetPlayback();
            this.render();
        }

        updateModeUI() {
            const goalSelect = document.getElementById('goal-select');
            if (goalSelect) goalSelect.style.display = this.mode === 'backward' ? 'inline-block' : 'none';
            // Hide goal indicator when switching modes
            this.updateGoalIndicator(null);
        }

        updateGoalIndicator(goalLabel, subgoalLabel = null) {
            const indicator = document.getElementById('goal-indicator');
            const indicatorText = document.getElementById('goal-indicator-text');
            if (!indicator || !indicatorText) return;

            if (goalLabel) {
                indicator.style.display = 'inline-flex';
                if (subgoalLabel && subgoalLabel !== goalLabel) {
                    indicatorText.textContent = `Proving: ${subgoalLabel} → ${goalLabel}`;
                } else {
                    indicatorText.textContent = `Proving: ${goalLabel}`;
                }
            } else {
                indicator.style.display = 'none';
            }
        }

        updateGoalIndicatorFromStep(step) {
            if (this.mode !== 'backward' || !step) {
                this.updateGoalIndicator(null);
                return;
            }

            // Get the main goal label
            const mainGoalDef = this.kb?.facts.find(f => f.id === this.selectedGoal);
            const mainGoalLabel = mainGoalDef ? mainGoalDef.label : this.selectedGoal;

            // Determine current subgoal based on step type
            let currentSubgoal = null;
            if (step.type === STEP_TYPES.BC_PROVE_CONDITION && step.conditionLabel) {
                currentSubgoal = step.conditionLabel;
            } else if (step.type === STEP_TYPES.BC_TRY_RULE && step.goal) {
                const goalDef = this.kb?.facts.find(f => f.id === step.goal);
                currentSubgoal = goalDef ? goalDef.label : step.goal;
            } else if (step.type === STEP_TYPES.BC_FIND_RULE && step.goalLabel) {
                currentSubgoal = step.goalLabel;
            } else if (step.type === STEP_TYPES.BC_ASK_USER && step.factLabel) {
                currentSubgoal = step.factLabel;
            }

            this.updateGoalIndicator(mainGoalLabel, currentSubgoal);
        }

        initPlayback() {
            if (!window.VizLib?.PlaybackController) return;

            this.playback = new window.VizLib.PlaybackController({
                initialSpeed: 5,
                onRenderStep: (step, index) => {
                    this.currentStep = step;
                    this.stepIndex = index;
                    this.render();
                    this.updateRulesHighlight();
                    this.updateFactsDisplay();
                    this.updateGoalIndicatorFromStep(step);
                },
                onPlayStateChange: isPlaying => this.updateButtons(isPlaying),
                onStepChange: (index, total) => this.updateStepDisplay(index, total),
                onFinished: () => this.updateButtons(false),
                onReset: () => {
                    this.currentStep = null;
                    this.stepIndex = -1;
                    this.render();
                    this.updateRulesHighlight();
                    this.updateGoalIndicator(null);
                }
            });

            const slider = document.getElementById('speed-slider');
            if (slider) this.playback.setSpeed(parseInt(slider.value));
        }

        runInference() {
            if (!this.engine) return;
            if (!this.playback) this.initPlayback();

            const saved = new Map();
            for (const [id, val] of this.engine.workingMemory) {
                const def = this.kb?.facts.find(f => f.id === id);
                if (def && !def.derived) saved.set(id, val);
            }
            this.engine.reset();
            for (const [id, val] of saved) this.engine.setFact(id, val);

            if (this.mode === 'forward') {
                this.steps = this.engine.runForwardChaining();
            } else {
                if (!this.selectedGoal) {
                    alert('Select a goal first');
                    return;
                }
                this.steps = this.engine.runBackwardChaining(this.selectedGoal);
            }

            if (this.playback) {
                this.playback.load(this.steps);
                this.playback.play();
            }
            this.updateButtons(true);
        }

        pausePlayback() {
            this.playback?.pause();
        }

        stepForward() {
            if (!this.playback && this.steps.length === 0) {
                this.runInference();
                this.playback?.pause();
                return;
            }
            this.playback?.stepForward();
        }

        stepBackward() {
            this.playback?.stepBackward();
        }

        resetPlayback() {
            this.playback?.reset();

            if (this.engine) {
                const saved = new Map();
                for (const [id, val] of this.engine.workingMemory) {
                    const def = this.kb?.facts.find(f => f.id === id);
                    if (def && !def.derived) saved.set(id, val);
                }
                this.engine.reset();
                for (const [id, val] of saved) this.engine.setFact(id, val);
            }

            this.currentStep = null;
            this.stepIndex = -1;
            this.steps = [];

            this.updateFactsDisplay();
            this.updateRulesHighlight();
            this.updateStepDisplay(-1, 0);
            this.updateButtons(false);
            this.render();
        }

        updateButtons(isPlaying) {
            const run = document.getElementById('btn-run');
            const pause = document.getElementById('btn-pause');
            const step = document.getElementById('btn-step');
            const back = document.getElementById('btn-step-back');

            if (run) run.disabled = isPlaying;
            if (pause) pause.disabled = !isPlaying;
            if (step) step.disabled = isPlaying;
            if (back) back.disabled = isPlaying || this.stepIndex <= 0;
        }

        updateStepDisplay(index, total) {
            const el = document.getElementById('playback-step');
            if (el) el.textContent = `Step: ${index + 1} / ${total}`;
        }

        updateRulesHighlight() {
            // Clear all highlights and status icons
            document.querySelectorAll('.rule-item').forEach(item => item.classList.remove('fired', 'evaluating', 'failed'));
            document.querySelectorAll('.rule-status-icon').forEach(icon => {
                icon.className = 'rule-status-icon';
            });

            if (!this.currentStep) return;

            const firedRules = this.currentStep.firedRules || new Set();
            const failedRules = this.failedRules || new Set();

            // Update fired rules
            for (const id of firedRules) {
                const ruleItem = document.getElementById(`rule-item-${id}`);
                if (ruleItem) {
                    ruleItem.classList.add('fired');
                    const statusIcon = ruleItem.querySelector('.rule-status-icon');
                    if (statusIcon) statusIcon.className = 'rule-status-icon fired';
                }
            }

            // Update currently evaluating rule
            if (this.currentStep.rule) {
                const ruleItem = document.getElementById(`rule-item-${this.currentStep.rule.id}`);
                if (ruleItem) {
                    const statusIcon = ruleItem.querySelector('.rule-status-icon');

                    if ([STEP_TYPES.FC_EVALUATE_RULE, STEP_TYPES.FC_RULE_MATCHES, STEP_TYPES.BC_TRY_RULE, STEP_TYPES.BC_PROVE_CONDITION].includes(this.currentStep.type)) {
                        ruleItem.classList.add('evaluating');
                        if (statusIcon) statusIcon.className = 'rule-status-icon evaluating';

                        // Scroll rule into view
                        ruleItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    } else if ([STEP_TYPES.FC_RULE_FAILS, STEP_TYPES.BC_RULE_FAIL].includes(this.currentStep.type)) {
                        ruleItem.classList.add('failed');
                        if (statusIcon) statusIcon.className = 'rule-status-icon failed';
                    }
                }
            }

            // Show pending status for rules not yet evaluated
            document.querySelectorAll('.rule-status-icon').forEach(icon => {
                if (!icon.classList.contains('fired') && !icon.classList.contains('evaluating') && !icon.classList.contains('failed')) {
                    icon.className = 'rule-status-icon pending';
                }
            });
        }

        render() {
            const ctx = this.ctx;
            const w = this.displayWidth;
            const h = this.displayHeight;

            ctx.fillStyle = this.colors.canvasBg;
            ctx.fillRect(0, 0, w, h);

            if (!this.layout) return;

            // Get current state
            const wm = this.currentStep?.workingMemory || this.engine?.workingMemory || new Map();
            const fired = this.currentStep?.firedRules || new Set();
            const derived = this.currentStep?.derivedFacts || new Set();
            const needed = this.currentStep?.neededFacts || new Set();
            const derivationInfo = this.currentStep?.derivationInfo || this.engine?.derivationInfo || new Map();
            const activeRule = this.currentStep?.rule;
            const stepType = this.currentStep?.type;

            // Get derivation path for selected fact (for highlighting)
            let derivationPath = { facts: new Set(), rules: new Set() };
            if (this.selectedFact && derivationInfo.has(this.selectedFact)) {
                derivationPath = this.getDerivationPath(this.selectedFact, derivationInfo);
            }

            // Draw edges first
            for (const edge of this.layout.edges) {
                const fromPos = this.layout.getNodePosition(edge.from.type, edge.from.id);
                const toPos = this.layout.getNodePosition(edge.to.type, edge.to.id);
                if (!fromPos || !toPos) continue;

                let color = this.colors.edgeDefault;
                let width = 1;
                let alpha = 1;

                // Check if this edge is part of the derivation path
                const isInDerivationPath = this.selectedFact && (
                    (edge.from.type === 'rule' && derivationPath.rules.has(edge.from.id)) ||
                    (edge.to.type === 'rule' && derivationPath.rules.has(edge.to.id)) ||
                    (edge.from.type === 'fact' && derivationPath.facts.has(edge.from.id)) ||
                    (edge.to.type === 'fact' && derivationPath.facts.has(edge.to.id))
                );

                // Dim edges not in derivation path when a fact is selected
                if (this.selectedFact && !isInDerivationPath) {
                    alpha = 0.2;
                }

                // Highlight edges related to fired rules
                if (edge.from.type === 'rule' && fired.has(edge.from.id)) {
                    color = this.colors.edgeFired;
                    width = 2;
                } else if (edge.to.type === 'rule' && fired.has(edge.to.id)) {
                    color = this.colors.edgeFired;
                    width = 2;
                }

                // Highlight edges for currently evaluating rule
                if (activeRule) {
                    if (edge.from.type === 'rule' && edge.from.id === activeRule.id) {
                        color = this.colors.edgeActive;
                        width = 2;
                    } else if (edge.to.type === 'rule' && edge.to.id === activeRule.id) {
                        color = this.colors.edgeActive;
                        width = 2;
                    }
                }

                // Boost derivation path edges
                if (isInDerivationPath) {
                    color = this.colors.factDerived;
                    width = 3;
                    alpha = 1;
                }

                this.drawEdge(ctx, fromPos, toPos, color, width, edge.from.type, edge.to.type, alpha);
            }

            // Draw fact nodes
            for (const [factId, node] of this.layout.factNodes) {
                let fillColor = this.colors.factBg;
                let strokeColor = this.colors.factUnknown;
                let strokeWidth = 2;
                let showQuestionMark = false;
                let alpha = 1;

                // Dim facts not in derivation path when a fact is selected
                if (this.selectedFact && !derivationPath.facts.has(factId)) {
                    alpha = 0.3;
                }

                // Highlight selected fact
                if (this.selectedFact === factId) {
                    strokeWidth = 4;
                }

                if (wm.has(factId)) {
                    const val = wm.get(factId);
                    if (val === true) {
                        strokeColor = derived.has(factId) ? this.colors.factDerived : this.colors.factTrue;
                        fillColor = this.hexToRgba(strokeColor, 0.15);
                    } else {
                        strokeColor = this.colors.factFalse;
                        fillColor = this.hexToRgba(strokeColor, 0.15);
                    }
                    strokeWidth = this.selectedFact === factId ? 4 : 3;
                } else if (needed.has(factId)) {
                    // Unknown but needed fact - show with orange/warning color
                    strokeColor = this.colors.factNeeded;
                    fillColor = this.hexToRgba(strokeColor, 0.2);
                    strokeWidth = this.selectedFact === factId ? 4 : 3;
                    showQuestionMark = true;
                }

                this.drawFactNode(ctx, node, fillColor, strokeColor, strokeWidth, showQuestionMark, alpha);
            }

            // Draw rule nodes
            for (const [ruleId, node] of this.layout.ruleNodes) {
                let fillColor = this.colors.ruleBg;
                let strokeColor = this.colors.ruleBorder;
                let strokeWidth = 1;
                let alpha = 1;

                // Dim rules not in derivation path when a fact is selected
                if (this.selectedFact && !derivationPath.rules.has(ruleId)) {
                    alpha = 0.3;
                }

                if (fired.has(ruleId)) {
                    strokeColor = this.colors.ruleFired;
                    fillColor = this.hexToRgba(strokeColor, 0.2);
                    strokeWidth = 2;
                } else if (activeRule && activeRule.id === ruleId) {
                    if ([STEP_TYPES.FC_EVALUATE_RULE, STEP_TYPES.FC_RULE_MATCHES, STEP_TYPES.BC_TRY_RULE].includes(stepType)) {
                        strokeColor = this.colors.ruleEvaluating;
                        fillColor = this.hexToRgba(strokeColor, 0.2);
                        strokeWidth = 2;
                    } else if ([STEP_TYPES.FC_RULE_FAILS, STEP_TYPES.BC_RULE_FAIL].includes(stepType)) {
                        strokeColor = this.colors.ruleFailed;
                        fillColor = this.hexToRgba(strokeColor, 0.2);
                        strokeWidth = 2;
                    }
                }

                // Highlight rules in derivation path
                if (derivationPath.rules.has(ruleId)) {
                    strokeColor = this.colors.factDerived;
                    strokeWidth = 3;
                    alpha = 1;
                }

                this.drawRuleNode(ctx, node, fillColor, strokeColor, strokeWidth, alpha);
            }

            // Draw message
            if (this.currentStep?.message) {
                this.drawMessage(ctx, this.currentStep.message);
            }
        }

        drawFactNode(ctx, node, fill, stroke, strokeWidth, showQuestionMark = false, alpha = 1) {
            ctx.globalAlpha = alpha;

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            ctx.fillStyle = this.colors.text;
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const label = node.label.length > 8 ? node.label.substring(0, 7) + '..' : node.label;
            ctx.fillText(label, node.x, node.y);

            // Draw question mark indicator for needed/unknown facts
            if (showQuestionMark) {
                const qX = node.x + node.radius * 0.6;
                const qY = node.y - node.radius * 0.6;
                const qRadius = 8;

                // Orange circle background
                ctx.beginPath();
                ctx.arc(qX, qY, qRadius, 0, Math.PI * 2);
                ctx.fillStyle = stroke;
                ctx.fill();

                // White question mark
                ctx.fillStyle = EAIColor('surface');
                ctx.font = 'bold 10px system-ui, sans-serif';
                ctx.fillText('?', qX, qY);
            }

            ctx.globalAlpha = 1;
        }

        drawRuleNode(ctx, node, fill, stroke, strokeWidth, alpha = 1) {
            const x = node.x - node.width / 2;
            const y = node.y - node.height / 2;

            ctx.globalAlpha = alpha;

            ctx.beginPath();
            this.roundRect(ctx, x, y, node.width, node.height, 4);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            ctx.fillStyle = this.colors.text;
            ctx.font = 'bold 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.label, node.x, node.y);

            ctx.globalAlpha = 1;
        }

        drawEdge(ctx, from, to, color, width, fromType, toType, alpha = 1) {
            // Adjust endpoints to be at node boundaries
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist === 0) return;

            const nx = dx / dist;
            const ny = dy / dist;

            // Adjust from point
            let fx = from.x, fy = from.y;
            if (fromType === 'fact') {
                const node = [...this.layout.factNodes.values()].find(n => Math.abs(n.x - from.x) < 1 && Math.abs(n.y - from.y) < 1);
                if (node) {
                    fx = from.x + nx * node.radius;
                    fy = from.y + ny * node.radius;
                }
            } else {
                const node = [...this.layout.ruleNodes.values()].find(n => Math.abs(n.x - from.x) < 1 && Math.abs(n.y - from.y) < 1);
                if (node) {
                    fx = from.x + nx * (node.height / 2);
                    fy = from.y + ny * (node.height / 2);
                }
            }

            // Adjust to point
            let tx = to.x, ty = to.y;
            if (toType === 'fact') {
                const node = [...this.layout.factNodes.values()].find(n => Math.abs(n.x - to.x) < 1 && Math.abs(n.y - to.y) < 1);
                if (node) {
                    tx = to.x - nx * node.radius;
                    ty = to.y - ny * node.radius;
                }
            } else {
                const node = [...this.layout.ruleNodes.values()].find(n => Math.abs(n.x - to.x) < 1 && Math.abs(n.y - to.y) < 1);
                if (node) {
                    tx = to.x - nx * (node.height / 2);
                    ty = to.y - ny * (node.height / 2);
                }
            }

            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();

            // Arrow head
            const arrowSize = 6;
            const angle = Math.atan2(ty - fy, tx - fx);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - arrowSize * Math.cos(angle - Math.PI / 6), ty - arrowSize * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(tx - arrowSize * Math.cos(angle + Math.PI / 6), ty - arrowSize * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        drawMessage(ctx, message) {
            const w = this.displayWidth;
            const h = this.displayHeight;
            const padding = 10;
            const fontSize = 12;

            ctx.font = `${fontSize}px system-ui, sans-serif`;
            const textWidth = ctx.measureText(message).width;
            const boxWidth = Math.min(textWidth + padding * 2, w - 40);
            const boxHeight = fontSize + padding * 2;
            const boxX = (w - boxWidth) / 2;
            const boxY = h - boxHeight - 10;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.beginPath();
            this.roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 4);
            ctx.fill();

            ctx.fillStyle = EAIColor('surface');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let displayMsg = message;
            if (textWidth > boxWidth - padding * 2) {
                const maxChars = Math.floor((boxWidth - padding * 2) / (textWidth / message.length));
                displayMsg = message.substring(0, maxChars - 3) + '...';
            }
            ctx.fillText(displayMsg, w / 2, boxY + boxHeight / 2);
        }

        roundRect(ctx, x, y, w, h, r) {
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        hexToRgba(hex, alpha) {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!result) return `rgba(128, 128, 128, ${alpha})`;
            return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
        }
    }

    // ============================================
    // Init
    // ============================================
    function init() {
        if (!document.getElementById('expert-canvas')) return;
        new ExpertSystemVisualizer('expert-canvas');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
