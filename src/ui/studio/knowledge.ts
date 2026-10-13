/** The design knowledge the Studio's prompts and feasibility checks draw on (see planRequest.ts). */
import { feasibilityContext, getElementDef, getTheme, guidanceFor, optionFeasibility } from '../../assets/design';
import type { PlanKnowledge } from './planRequest';

export const STUDIO_KNOWLEDGE: PlanKnowledge = { getElementDef, guidanceFor, getTheme, optionFeasibility, feasibilityContext };
