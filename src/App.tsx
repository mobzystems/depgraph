import { Fragment, ReactNode, useState } from "react";
import { open } from '@tauri-apps/api/dialog';
import { homeDir, dirname, resolve, basename } from '@tauri-apps/api/path';
import { readTextFile } from "@tauri-apps/api/fs";
import { invoke } from '@tauri-apps/api/tauri';
import "./App.css";

interface Project {
  // These fields are read from the solution file:

  // A Guid
  type: string,
  name: string,
  // Relative to solution path
  path: string,
  // Also a GUID, this time unique to the project
  guid: string,

  // These fields are added by the Solution:

  fullPath: string,
  referencedBy: string[],
  dependsOn: string[]
}

class Solution {
  // The projects in this solution
  public projects: Project[] = [];
  // The path of the solution
  public path: string;
  // The directpry containing the solution
  public directory?: string;
  // The name of the solution (from the file name)
  public name?: string;

  // A map of all projects in the solution, indexed on the full path name of the project file
  public allProjects: Map<string, Project> = new Map();

  public problems: string[] = [];

  public constructor(path: string) {
    this.path = path;
  }

  public async ReadDependencies() {
    console.log(`Parsing solution ${this.path}...`);

    this.directory = await dirname(this.path);
    const parser = new DOMParser();

    for (let p of this.projects) {
      p.dependsOn = [];
      p.referencedBy = [];

      p.fullPath = await resolve(this.directory, p.path);

      // Add this project to the project map
      this.allProjects.set(p.fullPath, p);

      const projectDir = await dirname(p.fullPath);

      let text = await invoke('read_all_text', { name: p.fullPath }) as string;
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.substring(1);
      }
      const xml = parser.parseFromString(text, 'text/xml');
      for (const ref of xml.documentElement.getElementsByTagName('ProjectReference')) {
        let projRef = ref.getAttribute('Include');
        // console.log(`${p.name}: ${ref.getAttribute('Include')}`);
        if (projRef) {
          const fullRef = await resolve(projectDir, projRef);
          p.dependsOn.push(fullRef);
        }
      }
    }

    // Loop again, this time resolving references:
    for (let p of this.projects) {
      // Check all dependencies:
      for (const dep of p.dependsOn) {
        // Check that we know this project
        let depProj = this.allProjects.get(dep);
        if (!depProj) {
          // console.log(`${p.name} references unknown project ${dep}. Add this project to the solution`);
          this.problems.push(`${p.name} references unknown project ${dep}. Add this project to the solution`);
        } else {
          depProj.referencedBy.push(p.fullPath);
        }
      }
    }
  }

  public projectByPath(name: string): Project | undefined {
    return this.allProjects.get(name);
  }

  private fileNameOf(name: string): string {
    const i = name.lastIndexOf('\\');
    if (i < 0)
      return name;
    else
      return "?" + name.substring(i + 1);
  }

  public safeProjectName(name: string): string {
    return this.projectByPath(name)?.name ?? this.fileNameOf(name);
  }

  public isProjectRelated(project: Project, focusedProject: string | undefined): boolean {
    if (focusedProject === undefined)
      return false;
    else
      return project.dependsOn.includes(focusedProject) || project.referencedBy.includes(focusedProject);
  }
}

function App() {
  const [solution, setSolution] = useState<Solution>();
  const [lastPath, setLastPath] = useState<string>();

  async function performOpen() {
    // Open a selection dialog for image files
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Solution files (*.sln)',
        extensions: ['sln']
      }],
      defaultPath: lastPath ?? await homeDir()
    });

    if (Array.isArray(selected)) {
      // User selected multiple files
      // This should not happen!
    } else if (selected === null) {
      // User cancelled the selection. Do nothing
    } else {
      // User selected a single file: parse it
      const sol = new Solution(selected);
      sol.name = await basename(sol.path);
      let text = await readTextFile(selected);
      const projectRegex = /^Project\("(?<type>[^"]+)"\) = "(?<name>[^"]+)", "(?<path>[^"]+)", "(?<guid>[^"]+)"/gim;
      for (; ;) {
        const match = projectRegex.exec(text);
        if (!match) break;
        const m = match.groups as any as Project;
        if (m.type !== '{2150E333-8FDC-42A3-9474-1A3956D46DE8}') // Skip "Solution items"
          sol.projects.push(m);
      }
      // Sort the projects by name
      sol.projects = sol.projects.sort((p1, p2) => p1.name.localeCompare(p2.name));

      await sol.ReadDependencies();
      setSolution(sol);
      setLastPath(selected);
    }
    // console.log(selected);
  }

  return (
    <div>
      {solution !== undefined ?
        <>
          <h1>Solution: {solution.name}</h1>
          <p>{solution.directory}</p>
          {solution.problems.length > 0 &&
            <div className="problems">
              <p>The following problems were found parsing the solution:</p>
              <ul>
                {solution.problems.map((p, index) => <li key={index}>{p}</li>)}
              </ul>
            </div>
          }
          {false && <ProjectList solution={solution!} />}
          <DependencyGraph solution={solution} openClicked={performOpen} closeClicked={() => setSolution(undefined)} />
        </> :
        <p>No solution loaded. <a href="#" onClick={(e) => { e.preventDefault(); performOpen() }}>Open a solution</a></p>
      }
    </div>
  );
}

/** The menu, fixed in the top right
 */
function Menu(props: {
  showDependencies: boolean,
  setShowDependencies: (show: boolean) => void,
  showReferences: boolean,
  setShowReferences: (show: boolean) => void,
  openClicked: () => void,
  closeClicked: () => void
}) {

  return (
    <div id="menu">
      <p>
        <input id="showReferences" type="checkbox" checked={props.showReferences} onChange={() => props.setShowReferences(!props.showReferences)} />
        <label htmlFor="showReferences">Show references</label>
      </p>
      <p>
        <input id="showDependencies" type="checkbox" checked={props.showDependencies} onChange={() => props.setShowDependencies(!props.showDependencies)} />
        <label htmlFor="showDependencies">Show dependencies</label>
      </p>
      <p>
        <button onClick={() => props.openClicked()}>Open solution</button>
      </p>
      <p>
        <button onClick={() => props.closeClicked()}>Close solution</button>
      </p>
    </div>
  );
}

interface Options {
  showDependencies: boolean,
  showReferences: boolean
}

/**
 * A dependency graph, consisting of levels
 */
function DependencyGraph(props: {
  solution: Solution,
  openClicked: () => void,
  closeClicked: () => void
}) {
  const [focusedProject, setFocusedProject] = useState<string>();
  const [showReferences, setShowReferences] = useState(false);
  const [showDependencies, setShowDependencies] = useState(true);

  const solution = props.solution;

  // The projects to display, i.e. the ones that are connected to any others
  // (they have dependencies or are depended upon)
  let projectsToDisplay = solution.projects.filter(p => p.dependsOn.length > 0 || p.referencedBy.length > 0);
  let displayedProjects = new Set<string>();

  let levels: ReactNode[] = [];

  let level = 1;
  for (; ;) {
    // Find the projects to display whose referencing projects have already been displayed, i.e. none of the referencing
    // project is NOT displayed (because that should come first)
    let projectsInThisLevel = projectsToDisplay.filter(p => p.referencedBy.filter(referringProject => !displayedProjects.has(referringProject)).length === 0);
    if (projectsInThisLevel.length === 0)
      break;
    levels.push(<GraphLevel
      level={level}
      solution={solution}
      projects={projectsInThisLevel}
      focusProject={(name) => setFocusedProject(name)}
      unfocusProject={(_) => setFocusedProject(undefined)}
      focusedProject={focusedProject} options={{ showDependencies: showDependencies, showReferences: showReferences }}
    />);
    // Mark the projects in this level as displayed
    for (const p of projectsInThisLevel) {
      displayedProjects.add(p.fullPath);
    }
    // Also remove them from the list of project to display:
    projectsToDisplay = projectsToDisplay.filter(p => !projectsInThisLevel.includes(p));
    // Level up
    level++;
  }

  // Return the graph (i.e. all levels generated) and the menu
  return (
    <div className="depgraph">
      <Menu
        showDependencies={showDependencies} setShowDependencies={setShowDependencies}
        showReferences={showReferences} setShowReferences={setShowReferences}
        openClicked={props.openClicked}
        closeClicked={props.closeClicked}
      />
      {levels.map((l, index) => <Fragment key={index}>{l}</Fragment>)}
    </div>
  );
}

/**
 * A level of projects. Level 1 is the top level without any references;
 * the last level contains only projects with no dependencies
 */
function GraphLevel(props: {
  level: number,
  solution: Solution,
  projects: Project[],
  focusedProject?: string,
  focusProject: (name: string) => void,
  unfocusProject: (name: string) => void,
  options: Options
}) {
  return (
    <div className="level" data-level={props.level}>
      {props.projects.map(p => <SingleProject
        key={p.fullPath}
        solution={props.solution}
        project={p}
        focusProject={props.focusProject}
        unfocusProject={props.unfocusProject}
        focusedProject={props.focusedProject}
        options={props.options}
      />)}
    </div>
  );
}

/**
 * A single project div, part of a GraphLevel
 */
function SingleProject(props: {
  solution: Solution,
  project: Project,
  focusedProject?: string,
  focusProject: (name: string) => void,
  unfocusProject: (name: string) => void,
  options: Options
}) {
  const solution = props.solution;
  const project = props.project;
  const focusedProject = props.focusedProject;

  return (
    <div className={`project ${project.fullPath === focusedProject ? "selected" : (solution.isProjectRelated(project, focusedProject) ? 'related' : undefined)}`} id={`proj-${project.fullPath}`}>
      <h3 onMouseOver={() => props.focusProject(project.fullPath)} onMouseOut={() => props.unfocusProject(project.fullPath)}>{project.name}</h3>
      {project.referencedBy.length > 0 && props.options.showReferences && <div className="referencedby">
        {project.referencedBy.map(ref => <div
          key={ref}
          className={ref === focusedProject ? "selected" : ''}
          onMouseOver={() => props.focusProject(ref)}
          onMouseOut={() => props.unfocusProject(ref)}>
          {"\u00AB"} {solution.safeProjectName(ref)}
        </div>)}
      </div>
      }
      {project.dependsOn.length > 0 && props.options.showDependencies && <div className="dependson">
        {project.dependsOn.map(dep => <div
          key={dep}
          className={dep === focusedProject ? "selected" : ''}
          onMouseOver={() => props.focusProject(dep)}
          onMouseOut={() => props.unfocusProject(dep)}>
          {"\u00BB"} {solution.safeProjectName(dep)}
        </div>)}
      </div>
      }
    </div>
  );
}

/**
 * A list of projects in textual form (mainly for debugging)
 */
function ProjectList(props: {
  solution: Solution
}) {
  const solution = props.solution;

  return (<>
    <h2>Projects</h2>
    <ol>
      {
        solution.projects.map(p => <li key={p.guid}>
          {p.name}
          {p.referencedBy.length > 0 &&
            <><p>ReferencedBy</p>
              <ul>
                {p.referencedBy.map(path => <li>{solution.safeProjectName(path)}</li>)}
              </ul>
            </>
          }
          {p.dependsOn.length > 0 &&
            <><p>DependsUpon</p>
              <ul>
                {p.dependsOn.map(path => <li>{solution.safeProjectName(path)}</li>)}
              </ul>
            </>
          }
        </li>)
      }
    </ol>
  </>);
}
export default App;

