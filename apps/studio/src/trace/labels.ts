// Plain-language labels for the legend. A lookup table, not a feature: the
// studio knows nothing about any protocol, it only has nicer words for a few
// message types and falls back to the raw msg.type for everything else.

const MESSAGE_LABELS: Readonly<Record<string, string>> = {
  RequestVote: 'asking for votes',
  RequestVoteResponse: 'vote reply',
  AppendEntries: 'leader heartbeat / replication',
  AppendEntriesResponse: 'replication reply',
};

export function messageLabel(type: string): string {
  return MESSAGE_LABELS[type] ?? type;
}

// Fixed palette for the role convention (SPEC §9). Anything else gets the
// neutral colour and its raw name.
export const ROLE_COLOURS: Readonly<Record<string, string>> = {
  leader: '#2f6fdb',
  candidate: '#e0a100',
  follower: '#c9c9c2',
};

export const NEUTRAL_ROLE_COLOUR = '#b8b8d0';

export function roleColour(role: string): string {
  return ROLE_COLOURS[role] ?? NEUTRAL_ROLE_COLOUR;
}
