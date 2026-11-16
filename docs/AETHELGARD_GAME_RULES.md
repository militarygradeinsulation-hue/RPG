# AETHELGARD: PROPHECY OF THE FOUR SEALS
## Game Rules and Build Prompt (Gameplay Systems Bible)

Put this file in the repo root. Give it to the coding agent with every build request. It is the single source of truth for how the world behaves. It extends three earlier prompts: Visuals (hyperrealism), World (open world, NPCs, towns, running), and Ocean (sea, ships, swimming, fish). If any instruction conflicts, this file wins.

---

## 0. ROLE AND INSTRUCTIONS TO THE AGENT

You are the lead gameplay and systems engineer for a Three.js (r160+) browser open-world RPG. You use Rapier (WASM) for physics, Web Workers for heavy simulation, and the pmndrs postprocessing library for effects.

Rules for how you work:
1. Read the relevant files before you change them. Do not guess the code structure.
2. Every system in this file is data-driven. Put tuning numbers in JSON config files under /data, not hard-coded in logic.
3. Every system must follow the Core Laws in Section 1. If a feature breaks a Core Law, stop and tell me.
4. Build one milestone at a time (Section 16). Each milestone must be playable and testable before the next starts.
5. For each milestone, return: files created or changed (full code), how to test in the browser, frame time cost, and what the next milestone depends on.
6. Report anything that does not fit the browser performance budget and give the best alternative.

---

## 1. CORE LAWS (NEVER BROKEN)

**LAW 1: Nothing passes through solid objects.**
Players, NPCs, animals, mounts, ships, projectiles, spells, items, and the camera all collide with walls, trees, rocks, terrain, buildings, and each other. No clipping, no tunneling, no walking through anything.

**LAW 2: Real-world physics is the default.**
Gravity is 9.81 m/s². Every physical object has real mass (kg), friction, and restitution. Momentum, inertia, and impact force are real. Falls cause damage based on impact speed. Heavy things are hard to push. Light things get knocked around.

**LAW 3: Magic follows rules too.**
Powers are physical. A fireball is a projectile with mass, speed, and a blast. Lightning follows a path to the nearest conductor. Frost changes the surface. Magic adds energy to the world. It does not ignore the world. Every power has a cost, a cast time, a range, and a counter.

**LAW 4: The world reacts.**
Fire burns what can burn. Water puts out fire. Ice melts near heat. NPCs and animals see, hear, and react to what the player does. Damage leaves marks.

**LAW 5: Systems interact.**
Every system talks to the others through the event bus: elements, weather, physics, AI, economy, and reputation. A feature that does not interact with anything is not done.

**LAW 6: Consistent units.**
1 unit = 1 meter. Mass in kg. Time in seconds. Speed in m/s. Temperature in °C. Force in newtons.

---

## 2. PHYSICS AND COLLISION RULES

### 2.1 Collision setup
- Every static object (walls, buildings, trees, rocks, terrain, cliffs) has a collider. Use simple shapes: trees are a capsule for the trunk plus no collider on the leaves; buildings use convex hulls or box compounds; terrain uses a heightfield collider per chunk.
- Every dynamic object (crates, barrels, loot, ragdolls, ships, carts) is a Rapier rigid body with real mass.
- Characters (player, NPCs, animals) use a kinematic character controller with a capsule sized to the model. Step height 0.35 m. Max walkable slope 45°. Steeper slopes make the character slide.
- Collision layers (bitmask groups): TERRAIN, STATIC, DYNAMIC, CHARACTER, MOUNT, SHIP, PROJECTILE, SPELL, WATER_TRIGGER, INTERACT_TRIGGER, RAGDOLL. Define which layers collide in /data/collision_matrix.json.
- Fast objects (arrows, fireballs, lightning, cannonballs, diving dragons) use continuous collision detection (CCD) so they never tunnel through thin walls.
- The camera has its own sphere collider. It pulls in toward the player when a wall or tree is between them. It never shows the inside of a wall.
- Colliders load and unload with world chunks. A chunk's colliders must be loaded before any character can enter that chunk.

### 2.2 Real-world physics values (store in /data/physics.json)
| Item | Value |
|---|---|
| Gravity | 9.81 m/s² |
| Player mass (no armor) | 80 kg |
| Walk speed | 1.6 m/s |
| Jog speed | 3.5 m/s |
| Sprint speed | 6.5 m/s |
| Jump height (no armor) | 0.5 m |
| Safe fall height | 4 m. Damage grows with impact speed above that. Death above about 20 m without magic. |
| Horse gallop | 13 to 16 m/s |
| Dragon flight cruise | 25 to 40 m/s, dive up to 70 m/s |
| Arrow speed | 50 to 70 m/s with real drop |
| Fireball speed | 25 m/s with slight drop |
| Cannonball speed | 120 to 150 m/s with real drop |
| Water density | 1000 kg/m³ (buoyancy) |

### 2.3 Weight and encumbrance
- Armor and carried items add real mass. More mass = slower acceleration, lower jump, more stamina use, harder to swim.
- Carry limit by Strength stat. Over the limit: the player can only walk. Far over: the player cannot move.
- Heavy armor sinks in deep water. The player must remove it or use magic to swim.

### 2.4 Physical interaction
- The player can push, pull, pick up, carry, and throw objects. The object's mass sets what is possible.
- Thrown objects deal impact damage based on mass and speed.
- Ragdolls on death and on heavy hits (blast, fall, charge). Ragdolls collide with the world and settle naturally.
- Destructible objects: wooden doors, fences, barrels, crates, carts, ship hulls, ice sheets, and weak walls in ruins break into physics pieces when force passes a threshold.
- Doors open with physics (push open, slam shut, can be barricaded).

### 2.5 Surface rules
- Each surface type has friction and a footstep sound: stone, wood, dirt, grass, snow (deep snow slows 30%), ice (low friction, sliding), sand, mud (slows 40%), water (shallow wading slows 25%), metal.
- Rain makes stone and wood slippery. Frost magic makes any surface ice.

---

## 3. MOVEMENT RULES

- Walk, jog, sprint (Shift), crouch/sneak (C), jump (Space), climb, swim, dive, mount.
- Sprint drains stamina. At zero stamina: forced jog, heavy breathing, no jumping for 2 seconds.
- Acceleration and deceleration are smooth. The character leans into turns and slides a little on ice.
- **Climbing:** the player can climb rough rock, ladders, vines, ship rigging, and castle walls that have handholds. Climbing drains stamina. Smooth walls cannot be climbed. Rain makes climbing slower.
- **Ledge grab:** the player catches ledges when a jump comes up short.
- **Mantling:** the player vaults over waist-high obstacles automatically.
- **Gliding (unlock):** an Air element power or a craftable glider lets the player glide from heights. Wind affects glide direction.
- **Fall damage** uses impact speed, reduced by landing in water, deep snow, hay, or a roll.
- **Dodge roll:** double-tap a direction. Costs stamina. Short invulnerability window.

---

## 4. ELEMENTAL POWERS (KEYS 1-4)

Powers must look, sound, and act like real powers. Every power is a physical event in the world.

### 4.1 Power rules
- Each power uses Mana. Mana regenerates over time, faster when not in combat.
- Every power has: cast time, mana cost, range, damage, area, physical force, element tag, cooldown, and what it reacts with.
- Tap = quick cast. Hold = charged cast (stronger, slower, more mana).
- Powers collide with the world (Law 1). A fireball hits a wall and explodes at the wall. It does not pass through.
- Powers push things with real force. A blast knocks over barrels, NPCs, and the player.
- Powers level up by use. Higher levels unlock new forms.
- Each power has a visual signature: particles, light that lights the scene, decals that stay, screen shake, and sound.

### 4.2 Fire (key 1)
| Form | Behavior |
|---|---|
| Fireball | Projectile, 25 m/s, slight drop, explodes on impact. Blast radius 3 m, knockback, sets flammable things on fire. |
| Flame stream | Hold to spray fire 6 m in a cone. Constant damage, sets grass and wood alight. Drains mana fast. |
| Fire wall | Line of fire on the ground that blocks paths and burns anything that crosses it. |
| Meteor (high level) | Called from the sky after 2 seconds. Huge blast, crater decal, ragdolls everything near it. |
- Fire lights the area with a real dynamic light. Burned surfaces get scorch decals. Burned grass turns to ash and regrows over days.
- **Fire spreads** to dry grass, trees, wood buildings, ship sails, and hay, faster with wind and slower in rain. Water, snow, and frost put it out.

### 4.3 Lightning (key 2)
| Form | Behavior |
|---|---|
| Bolt | Instant hit along a jagged path to the target. Chains to up to 3 nearby targets. Stuns for 0.5 s. |
| Chain storm | Hold to arc lightning between all enemies in range. |
| Thunder strike | Calls a bolt from the sky onto a target point. Needs open sky. Stronger in storms. |
| Static field | A ring around the player that zaps anyone who gets close. |
- Lightning seeks metal and water. Targets in metal armor or standing in water take double damage and chain further.
- Every bolt flashes the scene light and plays thunder delayed by distance (speed of sound, 343 m/s).
- Lightning can set fire to dry trees.

### 4.4 Frost (key 3)
| Form | Behavior |
|---|---|
| Ice shard | Fast projectile, pierces 1 target, slows. |
| Frost breath | Cone that slows and then freezes targets solid. Frozen targets shatter on a heavy hit. |
| Ice wall | Raises a solid ice wall with a real collider. Blocks attacks, can be climbed, melts over time and faster near fire. |
| Freeze water | Turns a patch of water to ice the player can walk on. Can trap ships and swimmers. |
- Frost puts out fire. Frozen ground becomes slippery ice.

### 4.5 Earth / Air (key 4, pick to match the lore; both specced so either works)
**Earth:**
| Form | Behavior |
|---|---|
| Rock throw | Rips a boulder from the ground and throws it. Heavy physical impact. |
| Stone spikes | Spikes burst from the ground in a line. Launch targets into the air. |
| Earth shield | Stone plates orbit the player and block projectiles. |
| Quake | Shakes the ground in a radius. Knocks down enemies, breaks weak structures. |

**Air:**
| Form | Behavior |
|---|---|
| Gust | Cone of wind that pushes enemies, objects, and fire. Can blow out torches and fires. |
| Wind dash | Fast burst of movement that can cross gaps. |
| Tornado | A moving vortex that lifts light objects and enemies. |
| Wind in sails | Fills a ship's sails from any direction for a short time. |
| Updraft | Lifts the player for gliding. |

### 4.6 Element interaction table (store in /data/element_reactions.json)
| A + B | Result |
|---|---|
| Fire + Frost | Steam cloud that blocks vision. Both cancel. |
| Fire + Air | Fire grows and spreads in the wind direction. Fire tornado if Air is a vortex. |
| Fire + Oil/Alcohol | Explosion. |
| Fire + Ice wall | Ice melts, creates water. |
| Lightning + Water | Electrifies the water area. Hits everyone in it. |
| Lightning + Metal | Damage doubled, chains further. |
| Frost + Water | Ice surface. |
| Frost + Wet target | Instant freeze. |
| Earth + Fire | Molten rock projectile, burns on impact. |
| Air + Frost | Blizzard that slows and blinds. |
| Air + Lightning | Storm cell that strikes randomly. |
| Rain weather | Fire weaker, lightning stronger, frost freezes faster. |
| Snow weather | Frost stronger, fire weaker. |
| Hot region | Fire stronger, frost weaker. |

### 4.7 Combo casting
- Dual cast: hold two element keys to fuse powers using the reaction table (fire + air = firestorm).
- Powers can be bound to weapons (fire sword, lightning arrows) through enchanting.

---

## 5. COMBAT RULES

- Melee: light attack (J), heavy attack (hold J), block (right mouse with shield or weapon), parry (block at the moment of impact), shield bash, kick.
- Hits are physical: weapon hitboxes follow the swing animation and collide with bodies. A swing that hits a wall bounces off and staggers the attacker.
- Directional damage: hits from behind or on a stunned target deal more damage. Headshots with arrows deal triple damage.
- Ranged: bows and crossbows with real arrow drop and travel time. Arrows stick in what they hit and can be picked back up.
- Stagger and poise: heavy weapons and heavy armor resist stagger.
- Stealth: sneak attacks deal 3x with daggers, 2x with bows. Light, noise, and line of sight decide detection. Sprinting and heavy armor make noise.
- Enemies fight with tactics: flank, block, retreat when hurt, call for help, use their own elements.
- Mounted combat: swing from horseback, joust charge, fire powers from a dragon.

---

## 6. ARMOR, WEAPONS, AND UPGRADES

### 6.1 Armor rules
- Slots: head, chest, hands, legs, feet, shield, cloak, ring x2, amulet.
- Armor classes: cloth, light (leather, hide), medium (chain, scale), heavy (plate). Each has real weight.
- Each piece has: armor rating, weight, durability, element resistances, noise level, and a set bonus.
- Armor visibly takes damage (scratches, dents, scorch marks) and loses rating as durability drops. Repair at a forge.
- Armor changes the look of the character model in full.
- Cold regions need warm gear (fur, enchantment, or fire power) or the player slowly freezes. Hot regions punish heavy armor with faster stamina drain.

### 6.2 Upgrade tiers
| Tier | Material | Where |
|---|---|---|
| 1 | Hide, leather, iron | Start, any blacksmith |
| 2 | Steel, chain | Towns |
| 3 | Elven / silver | Capitals, rare ore |
| 4 | Dwarven / black iron | Ruins, deep mines |
| 5 | Dragonbone / dragonscale | Dragon kills |
| 6 | Seal-forged (one per element) | Endgame, after each Seal |

### 6.3 Upgrade methods
- **Smithing:** mine ore, smelt at a smelter, forge at an anvil, temper at a grindstone (weapons) or workbench (armor). Skill level sets the max quality.
- **Enchanting:** bind an element to gear using element crystals found at shrines and from element creatures. Fire sword burns, frost armor slows attackers, lightning boots raise sprint speed.
- **Runes:** socket runes into gear for stat bonuses.
- **Set bonuses:** wearing a full matching set gives a special perk.
- **Mount armor:** horses, dragons, and ships can also be armored and upgraded.

---

## 7. HUNTING, FOOD, AND SURVIVAL

### 7.1 Wildlife
| Animal | Behavior | Yields |
|---|---|---|
| Deer, elk | Flee on sight or sound, run in herds | Venison, hide, antlers |
| Rabbit, fox | Flee fast, hide in brush | Small meat, pelt |
| Boar | Charges when cornered | Pork, tusks, hide |
| Wolf | Hunts in packs, circles, attacks the weakest | Pelt, fangs |
| Bear | Territorial, very strong, attacks if close | Bear meat, heavy pelt, claws |
| Mountain goat | Climbs cliffs | Goat meat, horns |
| Birds (pheasant, duck, eagle) | Fly off when startled | Fowl, feathers (for arrows) |
| Fish (see Ocean prompt) | Schools, flee | Fish meat |
| Horses (wild) | Flee, can be caught | See Section 8 |
| Element creatures | Region-specific, magical | Element crystals |
| Dragons | Apex, see Section 8 | Dragonbone, scales, souls |

### 7.2 Ecosystem rules
- Predators hunt prey on their own. Wolves chase deer. Bears fish in rivers. The player can come across these events.
- Animals have senses: sight cone, hearing, smell carried by wind direction. Approaching downwind is stealthier.
- Animals follow day and night patterns. Some only come out at night.
- Animal populations recover over time. Overhunting an area empties it for a while.
- Tracking: footprints in snow, mud, and sand. Blood trails from wounded animals. A tracking skill highlights recent tracks.

### 7.3 Harvest and food
- Hunted animals must be skinned and butchered (interact with the body, short animation). Yields depend on the kill method (fire scorches the pelt and lowers its value, a clean arrow shot gives the best pelt).
- Raw meat spoils after a few in-game days. Cooking, smoking, or salting preserves it.
- Cooking at campfires, inns, and home kitchens. Recipes combine meat, fish, vegetables, herbs, and spices.
- Food restores health and stamina over time, and some meals give buffs (warmth stew for cold regions, spicy dishes for fire resistance).
- Foraging: berries, mushrooms, herbs, roots. Some are poisonous.
- Farming at an owned home: plant, water, harvest.

### 7.4 Survival mode (optional setting, off by default)
- Hunger, thirst, fatigue, and body temperature.
- Cold slowly lowers health in frost regions without warm clothing, fire, or shelter.
- Sleep restores fatigue. Sleeping outside without a bedroll is not restful.
- Raw meat can cause sickness.

---

## 8. MOUNTS AND TAMING

### 8.1 Taming rules
- Any tameable creature has a Temper value. Lower it to tame.
- Methods by creature: feeding (bait), patience (approach slowly, crouched, without sprinting), breaking (mount and hold on through a balance minigame), or magic (element powers that match the creature).
- Failed taming makes the creature flee or attack.
- Tamed mounts have a name, stats, a bond level, and their own inventory (saddlebags).
- Bond grows by riding, feeding, and grooming. Higher bond = better obedience, faster recall, braver in combat.
- Mounts can be injured and killed. Heal with food, potions, or at a stable.
- Whistle (H) to call the mount. It runs to the player along a real path. It does not teleport through walls.

### 8.2 Horses
- Wild horse herds roam the plains. Catch one with the breaking minigame or buy from a stable.
- Breeds with different stats: speed, stamina, health, courage, carry weight.
- Real horse physics: momentum, turning radius at speed, jumps fences and logs, slows on steep slopes, refuses cliffs.
- Gaits: walk, trot, canter, gallop (Shift, drains horse stamina).
- Horses panic near fire, dragons, and bears unless bond is high.
- Horse armor and saddle upgrades.
- Carts and wagons can be hitched for trade runs.

### 8.3 Dragons
- Dragons live in mountain peaks, one or more per region, each matching the region's element.
- A wild dragon is a boss fight. Defeating it gives a choice: slay it (dragonbone, scales, a power upgrade) or tame it.
- Taming a dragon: weaken it below 20% health, then climb onto it (QTE climb along the body while it thrashes), and hold on through a flight struggle. Or complete a dragon-trust questline (bring offerings, prove the right element mastery).
- Dragon flight follows physics: lift, gravity, momentum. Climbing costs dragon stamina. Diving trades height for speed. Banking turns. Wind and storms push the dragon.
- Takeoff needs a short run or a cliff drop. Landing needs flat ground. Dragons cannot fly through mountains, trees, or buildings (Law 1).
- Dragon controls: W pitch down / S pitch up (or invert in settings), A/D bank, Shift flap boost, Space climb, Ctrl dive, Left click breath attack, Right click bite/claw, F land, E dismount.
- Dragon breath matches the element: fire breath, frost breath, lightning breath, or wind blast. It follows all element rules and reactions.
- Aerial combat: fight other dragons, attack ships, burn camps, fight sea monsters from above.
- Dragons need food (hunted livestock and game), rest, and a lair. A dragon left alone too long lowers bond.
- NPCs react: guards fire arrows and ballistas at dragons near towns unless the player has permission. Flying a dragon over a city causes panic.
- Limits: dragons are slow to call (they fly in from the lair), cannot enter towns, and cannot carry the player inside interiors.

### 8.4 Other mounts and companions
- Region mounts: giant elk (frost), ash lizard (fire), great stag (nature), griffin (air, limited flight).
- War hound companion: tracks animals, fights, carries a small pack.
- Sea mount: a tamed sea serpent or giant turtle for fast travel along the coast (late game).

---

## 9. SHIPS AND SAILING (EXTENDS OCEAN PROMPT)

- The player can control any ship they own or capture: steer at the helm, set sails, command crew, fire cannons, drop anchor, ram, and board.
- Ship physics: buoyancy from hull sample points against the wave height, real mass, drag, and wind force on the sails. A ship with a broken mast loses speed. A flooded hull sits lower and turns slower.
- Ships collide with docks, rocks, other ships, ice, and the seabed in shallow water (Law 1). Running aground damages the hull.
- Element powers on ships: Air fills sails, Frost freezes the water to trap an enemy ship, Fire sets enemy sails alight, Lightning strikes enemy masts in storms, Earth raises rocks from the seabed in shallow water.
- Crew commands: hold position, full sail, reload, repair, prepare to board, man the oars.
- Captain progression: ship upgrades, crew skills, captain reputation, a fleet of up to 3 ships late game.

---

## 10. NPC AND AI RULES

- NPCs follow daily schedules, react to the world, and remember the player.
- NPCs react to powers: they flee from fire, take cover from lightning storms, cheer at a dragon kill, panic if the player casts in town, and call guards if the player attacks.
- Witnesses: a crime only counts if someone sees or hears it. A witness who is silenced or flees past guards changes the outcome.
- Dynamic events: bandit raids on villages, dragon attacks on towns, merchant caravans attacked on roads, wolf packs hunting near farms, storms at sea, festivals in towns. The world runs these even when the player is not there (low-detail simulation).
- Companions: up to 2 human companions plus 1 animal. They fight, carry items, comment on the world, and have their own personal quests.
- Relationships: friendship, rivalry, marriage, and a household at an owned home.

---

## 11. WORLD SYSTEMS (MORE IDEAS)

1. **Seasons:** spring, summer, autumn, winter cycle every few in-game weeks. Snow lines move. Rivers freeze in winter (walkable). Animals migrate. Crops grow by season.
2. **Housing and building:** buy a house in town, or build a homestead from a modular kit (foundations, walls, roof, doors) with real collision and placement rules. Add a forge, kitchen, garden, stable, and dragon roost.
3. **Day/night threats:** undead and night creatures come out after dark. Torches and lanterns are needed in caves and at night.
4. **Caves and dungeons:** hand-designed and procedural, with traps (pressure plates, swinging blades, collapsing floors with real physics), puzzles using element powers (melt the ice door, light the braziers, raise the stone bridge, blow the wind chimes), and bosses.
5. **Bounties and law:** each region has its own law, guards, jail, and bounty. Pay, serve time, or fight.
6. **Economy:** prices react to supply and demand. Selling lots of pelts lowers pelt prices in that town for a while. Trade runs between regions by cart or ship.
7. **Guilds:** Hunters' Lodge, Mages' Circle (one tower per element), Sailors' Guild, Thieves' Guild, Dragon Riders' Order. Each has a questline and unique rewards.
8. **Arena and tournaments:** melee duels, archery contests, horse races, dragon races through rings, ship races between ports.
9. **Bestiary and map:** discovered creatures, locations, and lore fill a journal. The map reveals as the player explores.
10. **Photo mode:** pause, free camera, filters, depth of field.
11. **World events from Seal state:** each Seal the player restores (or breaks) changes the world: weather patterns, which creatures spawn, NPC dialogue, and the ending.
12. **Injuries:** heavy hits can cause a limp (slower), a broken arm (weaker swings), or bleeding (health drain) until treated with bandages, potions, or a healer.
13. **Fire and destruction persistence:** burned forests and broken buildings stay damaged, then regrow or get rebuilt by NPCs over in-game days.
14. **Carrying and logistics:** the player can drag bodies, carry a wounded companion, or load cargo onto carts and ships.

---

## 12. SKILLS AND PROGRESSION

- Skills improve by use: One-Handed, Two-Handed, Archery, Block, Heavy Armor, Light Armor, Sneak, Fire, Lightning, Frost, Earth/Air, Smithing, Enchanting, Alchemy, Cooking, Hunting, Taming, Riding, Sailing, Climbing, Speech.
- Level up from total skill gains. Each level gives a perk point and a choice to raise Health, Stamina, or Mana.
- Perk trees per skill with real gameplay changes, not only percent boosts (for example: Fire perk "Wildfire" makes fire spread 2x faster; Taming perk "Dragon Tongue" allows taming dragons without the fight).

---

## 13. CONTROLS (DEFAULT, REBINDABLE)

**On foot:** WASD move · Shift sprint · Space jump/climb · C crouch/sneak · Double-tap direction dodge · Mouse look · Left click / J attack · Right click block/aim · 1-4 elements (tap / hold) · Two element keys dual cast · E interact · R reload/ready weapon · F pick up/throw · G grab/drag · H whistle mount · Tab inventory · M map · Q journal · B bestiary · P photo mode · Esc pause

**Horse:** WASD steer · Shift gallop · Space jump · Left click mounted attack · E dismount

**Dragon:** W/S pitch · A/D bank · Shift flap boost · Space climb · Ctrl dive · Left click breath · Right click bite/claw · F land · E dismount

**Ship helm:** A/D steer · W/S sails · Mouse aim broadside · Left click fire · R change ammo · 1-4 element shot · Q crew command wheel · F board · E leave helm · X drop/raise anchor

**Swimming:** Space up · C dive · Shift sprint swim

---

## 14. UI AND FEEDBACK RULES

- HUD: health (red), stamina (green), mana (blue), compass at top with markers, breath meter when underwater, mount stamina when riding, ship hull/sail/crew bars at the helm.
- Hide the HUD when nothing is happening. Show bars only when they change.
- Damage numbers off by default (realism). Use hit reactions, blood, sparks, and sound instead.
- Every hit, cast, and impact gets sound, particles, and light. Bigger events get screen shake and controller rumble if a gamepad is connected.
- Gamepad support for all controls.

---

## 15. PERFORMANCE BUDGET AND PHYSICS LIMITS

- Target: 60 fps at 1080p on GTX 1660 / M1 class. 30 fps on Intel Iris Xe with Low preset.
- Physics step: fixed 60 Hz with interpolation for rendering. Rapier runs in a worker if the main thread is over budget.
- Active rigid bodies: max 300 near the player. Bodies that stop moving go to sleep.
- Ragdolls: max 10 active. Older ragdolls freeze into static poses.
- Fire spread: simulate on a coarse grid (2 m cells) in a worker. Max 200 burning cells. Rain and distance shrink the active area.
- Projectiles and spells: pooled objects, max 100 active.
- Full AI: max 30 NPCs and 20 animals near the player. Simplified simulation for the rest.
- Dragons: max 2 in full flight simulation at once.
- Debug overlay: fps, frame time, physics time, active bodies, active AI, burning cells, draw calls, memory.

---

## 16. BUILD ORDER (MILESTONES)

Combine with the World and Ocean milestones in this order:

| # | Milestone | Depends on |
|---|---|---|
| G1 | Rapier physics, collision layers, character controller, camera collision. Nothing passes through anything. | - |
| G2 | Movement: sprint, stamina, jump, crouch, dodge, climb, mantle, fall damage, surfaces | G1 |
| G3 | Physical objects: push, carry, throw, destructibles, ragdolls | G1 |
| W1-W3 | World: chunks, terrain, mountains, day/night, weather (World prompt) | G1 |
| G4 | Combat: melee hitboxes, block, parry, bows with arrow drop, stealth | G2 |
| G5 | Elemental powers: all 4 elements, all forms, element reaction table, fire spread | G3, G4 |
| G6 | Armor and weapons: slots, weight, durability, visual damage, smithing, enchanting, tiers | G4 |
| G7 | Wildlife and hunting: ecosystem AI, tracking, skinning, cooking, foraging | G4, W1 |
| W4-W6 | Roads, towns, NPCs, dialogue (World prompt) | G4 |
| G8 | Horses: wild herds, taming, riding physics, mounted combat, stables | G7 |
| O1-O3 | Ocean, swimming, fish (Ocean prompt) | W1 |
| G9 | Ships: player control, element powers at sea (with Ocean O4-O7) | G5, O3 |
| G10 | Dragons: wild dragon boss, taming, flight physics, breath, aerial combat | G5, G8 |
| G11 | Skills, perks, progression | G4-G10 |
| G12 | Housing, building, seasons, guilds, dynamic events, arenas | All above |
| G13 | Survival mode, injuries, photo mode, gamepad | All above |

---

## 17. ACCEPTANCE TESTS (RUN AFTER EVERY MILESTONE)

1. Walk, sprint, and dodge into every wall, tree, rock, and building type. Nothing clips.
2. Fire a fireball, arrow, and cannonball at a thin wall at max speed. Nothing tunnels through.
3. Move the camera behind a wall and a tree. The camera never shows the inside of geometry.
4. Drop from 3 m, 8 m, 15 m, and 25 m. Damage matches the rules.
5. Equip heavy armor and swim. The player sinks as specified.
6. Cast fire on dry grass in wind. Fire spreads downwind. Rain puts it out.
7. Hit enemies in water with lightning. Damage doubles and chains.
8. Freeze water and walk on it. Melt it with fire.
9. Hunt a deer from upwind and downwind. Detection differs.
10. Tame a horse, ride into a fence at a gallop, and jump it. Collision and jump both work.
11. Fly a dragon into a mountain. It collides and takes damage. It cannot pass through.
12. Steer a ship onto rocks. The hull takes damage.
13. Frame time stays within budget during a fight with 10 enemies, 3 fires, and a dragon overhead.

Report pass or fail for each test with the measured numbers.
