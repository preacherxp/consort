// Shared spring vocabulary: surfaces settle gently; small controls respond faster.
export const surfaceSpring = { type: 'spring', stiffness: 420, damping: 38, mass: .85 } as const;
export const controlSpring = { type: 'spring', stiffness: 520, damping: 40, mass: .7 } as const;
