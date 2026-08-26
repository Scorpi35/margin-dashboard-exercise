import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Testing Library unmounts between tests automatically only when Vitest globals
 * are on. They are off here — describe/expect/it are imported explicitly — so the
 * teardown has to be wired up by hand, or every render stacks onto the previous
 * one and queries start finding two of everything.
 */
afterEach(cleanup);
