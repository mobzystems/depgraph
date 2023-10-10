import { open } from '@tauri-apps/api/dialog';
import { readTextFile } from "@tauri-apps/api/fs";
import { basename, dirname, homeDir, resolve, sep } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { useEffect, useState } from "react";
import "./App.scss";
import { getVersion } from '@tauri-apps/api/app';
import { Child, Command } from '@tauri-apps/api/shell';
import classlist from './classlist.ts';
import { Arch, OsType, Platform, arch as tauriArch, platform as tauriPlatform, type as tauriType} from '@tauri-apps/api/os';
import useBackend from './Backend.ts';

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

  // A list of problem messages
  public problems: string[] = [];

  // A list of "levels". Each level contains the projects in it
  // The top level (#0) contains the projects that have no other projects referencing them;
  // the bottom level contains the project wihtout any dependencies
  public levels: Project[][] = [];

  // The number of 'orphan' projects (projects that have no references or dependencies)
  public orphanCount = 0;

  public constructor(path: string) {
    this.path = path;
  }

  public normalizePath(path: string) {
    // Use the platform-specific path separator
    return path.replace(/\\/g, sep); 
  }

  public async ReadDependencies() {
    console.log(`Parsing solution ${this.path}...`);

    this.directory = await dirname(this.path);
// console.log("Directory is " + this.directory);
    const parser = new DOMParser();

    let missingProjects: string[] = [];

    for (let p of this.projects) {
      p.dependsOn = [];
      p.referencedBy = [];

// console.log(this.directory + "--" + p.path);

      p.fullPath = await resolve(this.directory, p.path);

      if (await invoke('file_exists', { name: p.fullPath })) {
        console.log('Reading ' + p.fullPath + '...');

        // Add this project to the project map
        this.allProjects.set(p.fullPath, p);

        const projectDir = await dirname(p.fullPath);
// console.log(p.fullPath);

        let text = await invoke('read_all_text', { name: p.fullPath }) as string;
        if (text.charCodeAt(0) === 0xFEFF) {
          text = text.substring(1);
        }
        const xml = parser.parseFromString(text, 'text/xml');
        for (const ref of xml.documentElement.getElementsByTagName('ProjectReference')) {
          let projRef = ref.getAttribute('Include');
          // console.log(`${p.name}: ${ref.getAttribute('Include')}`);
          if (projRef) {
            const fullRef = await resolve(projectDir, this.normalizePath(projRef));
// console.log(fullRef);
            p.dependsOn.push(fullRef);
          }
        }
      } else {
        this.problems.push(`Project file '${p.fullPath}' does not exist`);
        missingProjects.push(p.fullPath);
      }
    }

    // Loop again, this time resolving references:
    for (let p of this.projects) {
      // Check all dependencies:
      for (const dep of p.dependsOn) {
        // If we know the project is missing don't warn here
        if (missingProjects.includes(dep))
          continue;

        // Check that we know this project
        let depProj = this.allProjects.get(dep);
        if (!depProj) {
          // console.log(`${p.name} references unknown project ${dep}. Add this project to the solution`);
          this.problems.push(`Project '${p.name}' references unknown project '${dep}'. Add this project to the solution`);
        } else {
          depProj.referencedBy.push(p.fullPath);
        }
      }
    }

    // Now distribute the projects over "levels":
    // The projects to display, i.e. the ones that are connected to any others
    // (they have dependencies or are depended upon)
    let projectsToDisplay = this.projects.filter(p => p.dependsOn.length > 0 || p.referencedBy.length > 0);
    this.orphanCount = this.projects.length - projectsToDisplay.length;

    let displayedProjects = new Set<string>();

    this.levels = [];

    for (; ;) {
      // Find the projects to display whose referencing projects have already been displayed, i.e. none of the referencing
      // project is NOT displayed (because that should come first)
      let projectsInThisLevel = projectsToDisplay.filter(p => p.referencedBy.filter(referringProject => !displayedProjects.has(referringProject)).length === 0);
      if (projectsInThisLevel.length === 0)
        break;
      this.levels.push(projectsInThisLevel);
      // Mark the projects in this level as displayed
      for (const p of projectsInThisLevel) {
        displayedProjects.add(p.fullPath);
      }
      // Also remove them from the list of project to display:
      projectsToDisplay = projectsToDisplay.filter(p => !projectsInThisLevel.includes(p));
    }
  }

  public projectByPath(name: string): Project | undefined {
    return this.allProjects.get(name);
  }

  private fileNameOf(name: string): string {
    const i = name.lastIndexOf(sep);
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
  const [originalTitle, setOriginalTitle] = useState(''); // The original window title
  const [result, setResult] = useState<string>();
  const [architecture, setArchitecture] = useState<Arch>();
  const [platform, setPlatform] = useState<Platform>();
  const [osType, setOsType] = useState<OsType | undefined>();
  const [backend] = useState<Child | undefined>(useBackend());
  
  useEffect(() => {
    async function getCaption() {
      setArchitecture(await tauriArch());
      setPlatform(await tauriPlatform());
      setOsType(await tauriType());

      const title = await appWindow.title();
      // console.log("Title: " + title);
      const version = await getVersion();
      // console.log("Version: " + version)
      const caption = `${title} v${version}`;
      await appWindow.setTitle(caption);
      return caption;
    }
    if (originalTitle === '') {
      getCaption().then(caption => setOriginalTitle(caption));
    }
  }, [originalTitle]);

  useEffect(() => {
    if (backend)
      console.log(`Backend process is now ${backend.pid}`);
    else
      console.log("No backend yet");
  }, [backend]);

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
        if (
          m.type !== '{2150E333-8FDC-42A3-9474-1A3956D46DE8}'  // Skip "Solution items"
          && m.type !== '{E24C65DC-7377-472B-9ABA-BC803B73C61A}' // Skip web projects
        )
          // The match has the same structure as a project, so we can add it here:
          sol.projects.push(m);
      }

      // Perform path replacement:
      for (let i = 0; i < sol.projects.length; i++)
        sol.projects[i].path = sol.normalizePath(sol.projects[i].path);

      // Sort the projects by name
      sol.projects = sol.projects.sort((p1, p2) => p1.name.localeCompare(p2.name));

      await sol.ReadDependencies();
      setSolution(sol);
      await appWindow.setTitle(`${sol.name} - ${originalTitle}`);
      setLastPath(selected);
    }
    // console.log(selected);
  }

  async function runServices() {
    const hello = await (await fetch('http://localhost:50000')).text();
    setResult(hello);
  }

  // Show the current solution in Explorer
  async function performExplore(path: string) {
    const command = new Command('explorer', ['/select,', path]);
    await command.spawn();
  }

  return (
    <div id="grid">
      {solution !== undefined ?
        <>
          <div id="head">
            <h1>Solution: {solution.name}</h1>
            <p>
              In <a href="#" onClick={async (e) => { e.preventDefault; await performExplore(solution.path) }}>{solution.directory}</a>.
              Contains {solution.projects.length} project(s) in {solution.levels.length} level(s).
              {solution.orphanCount > 0 && <>{solution.orphanCount} project(s) have neither dependencies or references ({solution.projects.filter(p => p.dependsOn.length === 0 && p.referencedBy.length === 0).map(p => p.name).join(', ')}).</>}
            </p>
            {solution.problems.length > 0 && <ProblemList solution={solution} />}
            {false && <ProjectList solution={solution!} />}
          </div>
          <div id="main">
            <DependencyGraph solution={solution} openClicked={performOpen} closeClicked={() => setSolution(undefined)} />
          </div>
        </>
        :
        <>
          <div id="head">
            <p>No solution loaded. <a href="#" onClick={(e) => { e.preventDefault(); performOpen() }}>Open a solution</a></p>
            <p><button onClick={() => runServices()}>Run sidecar</button></p>
            {result !== undefined && <p>Result: {result}</p>}
            <p>Architecture <strong>{ architecture }</strong>, Platform <strong>{ platform }</strong>, Type <strong>{ osType }</strong></p>
          </div>
        </>
      }
    </div>
  );
}

/**
 * The list of problems
 */
function ProblemList(props: {
  solution: Solution
}) {
  const [visible, setVisible] = useState(true);

  const solution = props.solution;

  return (<>
    <div className="problems">
      {visible ?
        <>
          <p>The following problems were found parsing the solution:  <a href="#" onClick={(e) => { e.preventDefault(); setVisible(false) }}>hide</a></p>
          <ul>
            {solution.problems.map((p, index) => <li key={index}>{p}</li>)}
          </ul>
        </>
        :
        <>
          <p>This solution contains {solution.problems.length} problem(s) <a href="#" onClick={(e) => { e.preventDefault(); setVisible(true) }}>show</a></p>
        </>
      }
    </div>
  </>);
}

/**
 * The menu, fixed in the top right
 */
function Menu(props: {
  showDependencies: boolean,
  setShowDependencies: (show: boolean) => void,
  showReferences: boolean,
  setShowReferences: (show: boolean) => void,
  openClicked: () => void,
  closeClicked: () => void
}) {

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div id="menu">
      <div className="collapse">
        {collapsed ? <span onClick={() => setCollapsed(false)}>{'\u23f7'}</span> : <span onClick={() => setCollapsed(true)}>{'\u23f6'}</span>}
      </div>
      {!collapsed && <>
        <p>
          <input id="showReferences" type="checkbox" checked={props.showReferences} onChange={() => props.setShowReferences(!props.showReferences)} />
          <label htmlFor="showReferences">Show references</label>
        </p>
        <p>
          <input id="showDependencies" type="checkbox" checked={props.showDependencies} onChange={() => props.setShowDependencies(!props.showDependencies)} />
          <label htmlFor="showDependencies">Show dependencies</label>
        </p>
        <p>
          <button onClick={() => props.openClicked()}>Open solution...</button>
        </p>
        <p>
          <button onClick={() => props.closeClicked()}>Close solution</button>
        </p>
      </>
      }
    </div>
  );
}

/**
 * The details pane at the lower left
 */
function DetailsPanel(props: {
  solution: Solution,
  projectName: string
}) {
  const project = props.solution.projectByPath(props.projectName);
  if (project === undefined)
    return null;

  return (<>
    <div id="details">
      <SingleProject
        solution={props.solution}
        project={project}
        options={{ showDependencies: true, showReferences: true }}
        focusProject={() => { }}
        unfocusProject={() => { }}
      />
    </div>
  </>);
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

  return (
    <div className="depgraph">
      <Menu
        showDependencies={showDependencies} setShowDependencies={setShowDependencies}
        showReferences={showReferences} setShowReferences={setShowReferences}
        openClicked={props.openClicked}
        closeClicked={props.closeClicked}
      />
      {focusedProject !== undefined && <DetailsPanel solution={solution} projectName={focusedProject} />}
      {solution.levels.map((projects, level) => <GraphLevel
        key={level}
        level={level + 1}
        solution={solution}
        projects={projects}
        focusProject={(name) => setFocusedProject(name)}
        unfocusProject={(_) => setFocusedProject(undefined)}
        focusedProject={focusedProject} options={{ showDependencies: showDependencies, showReferences: showReferences }}
      />
      )}
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

  function SafeProjectName(props: { name: string }) {
    const name = props.name;
    if (name.substring(0, 1) === '?')
      return <s>{name.substring(1)}</s>;
    else
      return name;
  }

  return (
    <div
      className={classlist([
        'project',
        project.fullPath === focusedProject ? "selected" : (solution.isProjectRelated(project, focusedProject) ? 'related' : undefined)
      ])}
      id={`proj-${project.fullPath}`}
    >
      <h3 onMouseOver={() => props.focusProject(project.fullPath)} onMouseOut={() => props.unfocusProject(project.fullPath)}>{project.name}</h3>
      {project.referencedBy.length > 0 && props.options.showReferences && <div className="referencedby">
        {project.referencedBy.map(ref => <div
          key={ref}
          className={ref === focusedProject ? "selected" : undefined}
          onMouseOver={() => props.focusProject(ref)}
          onMouseOut={() => props.unfocusProject(ref)}>
          {"\u00AB"} <SafeProjectName name={solution.safeProjectName(ref)} />
        </div>)}
      </div>
      }
      {project.dependsOn.length > 0 && props.options.showDependencies && <div className="dependson">
        {project.dependsOn.map(dep => <div
          key={dep}
          className={dep === focusedProject ? "selected" : undefined}
          onMouseOver={() => props.focusProject(dep)}
          onMouseOut={() => props.unfocusProject(dep)}>
          {"\u00BB"} <SafeProjectName name={solution.safeProjectName(dep)} />
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

