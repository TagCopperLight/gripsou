
export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

export function resetLink(token: string): string {
  return `${window.location.origin}/reset/${token}`;
}
