// Teams and their roles.
//
// A page is owned by a ROLE (for example "Website Editor"), never by a person's name. The person
// who currently holds each role is listed in teams/<team>.json. When someone changes jobs, change
// "person" in that file: every page that names the role shows the new person, with no page edits.
// The file is read fresh each time, so a change applies without restarting the server.

import fs from 'node:fs/promises';
import path from 'node:path';
import { here } from './config.js';

// Only one team exists for now. Drafts are stored under this team and new pages belong to it.
const TEAM_FILE = path.join(here, 'teams', 'legwork-web-team.json');

export async function readTeam() {
  var team = JSON.parse(await fs.readFile(TEAM_FILE, 'utf8'));
  var valid = team && typeof team.name === 'string' && /^[a-z0-9-]+$/.test(team.slug || '') && Array.isArray(team.roles);
  if (!valid) { throw new Error('teams/legwork-web-team.json needs a name, a slug (lowercase letters, numbers, hyphens) and a roles list.'); }
  team.roles = team.roles.filter(function (role) { return role && typeof role.title === 'string' && role.title.trim(); });
  return team;
}

// Tells the AI who holds each role, so a person named in a document is written as their job title
export function rosterNote(team) {
  if (!team || !team.roles.length) { return ''; }
  return [
    'Team roster for the ' + team.name + '. Pages name a job title, not a person, so contact details stay right when someone',
    'changes jobs. When the text names one of these people, write their job title instead (for example, write the Website Editor, not their name):',
    team.roles.map(function (role) { return '- ' + role.title + ': ' + (role.person || 'unassigned'); }).join('\n')
  ].join('\n');
}
