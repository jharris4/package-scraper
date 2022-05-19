const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { env } = require("process")

const minSeverityName = 'low';
const yarnAuditParams = ['audit', '--json', `--level=${minSeverityName}`];
const depCheckParams = ['depcheck', '--json'];

const doSpawn = (basePath, cmd, params) => {
  return new Promise((resolve, reject) => {
    const command = spawn(cmd, params, { env, cwd: basePath });
    let result = '';
    command.stdout.on('data', data => { result += data.toString(); });
    //command.on('exit', () => { })
    command.on('close', () => { resolve(result); });
    command.on('error', err => { reject(err); });
  });
};

const streamYarnAuditOutput = basePath => {
  return doSpawn(basePath, 'yarn', yarnAuditParams);
};

const streamDepCheckOutput = basePath => {
  return doSpawn(basePath, 'npx', depCheckParams);
}

const getPackages = basePath => {
  const packageJSON = fs.readFileSync(path.join(basePath, 'package.json'), 'utf8');
  try {
    const packageObject = JSON.parse(packageJSON);
    const { dependencies = {}, peerDependencies = {}, devDependencies = {} } = packageObject;
    return {
      dependencies,
      peerDependencies,
      devDependencies,
      dependenciesAudit: {},
      peerDepenciesAudit: {},
      devDependenciesAudit: {}
    };

  } catch (err) {
    console.error('error reading package: ', err);
  }
};

const pruneUnusedPackages = (basePath, packageMap) => {
  return streamDepCheckOutput(basePath).then(result => {
    const newPackageMap = Object.assign({}, packageMap);
    try {
      const unusedPackageMap = JSON.parse(result);
      const { dependencies = [], peerDependencies = [], devDependencies = [] } = unusedPackageMap;
      for (let dependency of dependencies) {
        delete newPackageMap.dependencies[dependency];
      }
      for (let dependency of peerDependencies) {
        delete newPackageMap.peerDependencies[dependency];
      }
      for (let dependency of devDependencies) {
        delete newPackageMap.devDependencies[dependency];
      }
    } catch (err) {
      console.error('unused parse error: ', err);
    }
    // console.log('%%%%% depcheck result:');
    // console.log(result);
    return newPackageMap;
  })
};

const scrapePackage = basePath => {
  return new Promise((resolve, reject) => {
    const packageMap = getPackages(basePath);

    pruneUnusedPackages(basePath, packageMap).then(prunedPackageMap => {
      const getAuditMapForPackageName = packageName => {
        if (prunedPackageMap.dependencies[packageName] !== undefined) {
          return prunedPackageMap.dependenciesAudit;
        } else if (prunedPackageMap.peerDependencies[packageName] !== undefined) {
          return prunedPackageMap.peerDependenciesAudit;
        } if (prunedPackageMap.devDependencies[packageName] !== undefined) {
          return prunedPackageMap.devDependenciesAudit;
        }
      }
      
      streamYarnAuditOutput(basePath).then(result => {
        // console.log('result: ' + result);
        const resultLines = result.split('\n');
        for (let resultLine of resultLines) {
          if (resultLine.trim().length > 0) {
            try {
              const resultObject = JSON.parse(resultLine);
              const { data } = resultObject;
              const { advisory } = data;
              if (advisory !== undefined) {
                const { findings, severity } = advisory;
                for (let finding of findings) {
                  const { paths } = finding;
                  for (let path of paths) {
                    const packageName = path.split('>')[0];
                    const auditMap = getAuditMapForPackageName(packageName);
                    if (auditMap) {
                      if (auditMap[packageName] === undefined) {
                        auditMap[packageName] = {};
                      }
                      if (auditMap[packageName][severity] === undefined) {
                        auditMap[packageName][severity] = 1;
                      } else {
                        auditMap[packageName][severity] = auditMap[packageName][severity] + 1;
                      }
                    }
                  }
                }
              }
            } catch (err) {
              reject(err);
              console.error(err);
            }
          }
        }
        resolve(prunedPackageMap);
        // console.log('scrape result:');
        // console.log(JSON.stringify(prunedPackageMap, null, '  '));
      }, err => reject(err));
    }, err => reject(err));
  });
};

const getLatestVersion = packageName => {
  return ('' + execSync(`npm show ${packageName} version`)).trim();
};

const addDependenciesOfType = (project, dependencies, globalDependencies) => {
  const packageNames = dependencies !== undefined ? Object.keys(dependencies) : [];
  for (let packageName of packageNames) {
    const packageVersion = dependencies[packageName];
    const globalPackage = globalDependencies[packageName];
    if (globalPackage !== undefined) {
      if (globalPackage[packageVersion] !== undefined) {
        globalPackage[packageVersion].push(project);
      } else {
        globalPackage[packageVersion] = [project];
      }
    } else {
      globalDependencies[packageName] = {
        '_latest_': getLatestVersion(packageName),
        [packageVersion]: [project]
      };
    }
  }
}

const addDependenciesAuditOfType = (project, dependencies, depenciesAudit, globalDependenciesAudit) => {
  const packageNames = depenciesAudit !== undefined ? Object.keys(depenciesAudit) : [];
  for (let packageName of packageNames) {
    const packageVersion = dependencies[packageName];
    const auditStats = depenciesAudit[packageName];
    const globalPackageAudit = globalDependenciesAudit[packageName];
    if (globalPackageAudit !== undefined) {
      if (globalPackageAudit[packageVersion] !== undefined) {
        globalPackageAudit[packageVersion].projects.push(project);
      } else {
        globalPackageAudit[packageVersion] = {
          projects: [project],
          stats: auditStats
        }
      }
    } else {
      globalDependenciesAudit[packageName] = {
        [packageVersion]: {
          projects: [project],
          stats: auditStats
        }
      };
    }
  }
}

const addDependencies = (project, packageJSON, packages) => {
  const { dependencies, peerDependencies, devDependencies } = packageJSON;
  addDependenciesOfType(project, dependencies, packages.dependencies);
  addDependenciesOfType(project, peerDependencies, packages.peerDependencies);
  addDependenciesOfType(project, devDependencies, packages.devDependencies);
};

const addDependenciesAudit = (project, packageJSON, packages) => {
  const {  dependencies, peerDependencies, devDependencies, dependenciesAudit, peerDependenciesAudit, devDependenciesAudit } = packageJSON;
  addDependenciesAuditOfType(project, dependencies, dependenciesAudit, packages.dependenciesAudit);
  addDependenciesAuditOfType(project, peerDependencies, peerDependenciesAudit, packages.peerDependenciesAudit);
  addDependenciesAuditOfType(project, devDependencies, devDependenciesAudit, packages.devDependenciesAudit);
};

module.exports = {
  scrapePackage,
  addDependencies,
  addDependenciesAudit
};
