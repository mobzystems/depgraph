/**
 *  classList(string[]) - return a space delimited list of trimmed class names or undefined if no non-empty class names present
 */
export default function classList(classes: (string | undefined)[] | undefined): string | undefined
{
    // If no or empty classes: undefined
    if (classes === undefined || classes.length === 0)
        return undefined;
    // Count the number of non-undefined and non-empty class names
    const effectiveClasses = classes.filter(className => className !== undefined && className.trim().length !== 0) as string[];
    // None? undefined
    if (effectiveClasses.length === 0)
        return undefined;
    // Convert the non-empty class names to a space delimited string
    return effectiveClasses.map(className => className.trim()).join(' ');
}