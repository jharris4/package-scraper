#! /usr/bin/env node
const fs = require('fs');
const path = require('path');

const { scrapePackage, addDependencies, addDependenciesAudit } = require('../src/scrapePackage.js');

const scrapePackages = async packagesObject => {
  const packageMap = {};
  const packageGroups = Object.keys(packagesObject);
  for (let packageGroup of packageGroups) {
    packageMap[packageGroup] = {};
    const packages = packagesObject[packageGroup];
    for (let package of packages) {
      const { name, path } = package;
      const resolvedPath = path.startsWith('.') ? path.join(process.cwd(), path) : path;
      packageMap[packageGroup][name] = await scrapePackage(resolvedPath);
      // scrapePackage(path).then(result => {
      //   packageMap[packageGroup][name] = result;
      // });
    }
  }
  return packageMap;
};

const combinePackages = packageMap => {
  const combinedPackageMap = {};
  const packageGroups = Object.keys(packageMap);
  for (let packageGroup of packageGroups) {
    combinedPackageMap[packageGroup] = {
      dependencies: {}, peerDependencies: {}, devDependencies: {},
      dependenciesAudit: {}, peerDependenciesAudit: {}, devDependenciesAudit: {}
    };
    const projectMaps = packageMap[packageGroup];
    const projects = Object.keys(projectMaps);
    for (let project of projects) {
      const projectPackages = projectMaps[project];
      addDependencies(project, projectPackages, combinedPackageMap[packageGroup]);
      addDependenciesAudit(project, projectPackages, combinedPackageMap[packageGroup]);
    }
  }
  return combinedPackageMap;
};

const startDate = new Date();
const packagesText = fs.readFileSync('./packages.json', 'utf8');
try {
  const packagesObject = JSON.parse(packagesText);
  scrapePackages(packagesObject).then(packageMap => {
    const combinedPackageMap = combinePackages(packageMap);
    console.log('packageMap saving to file');
    // console.log(JSON.stringify(combinedPackageMap, null, '  '));
    fs.writeFileSync('./packageMap.json', JSON.stringify(combinedPackageMap, null, '  '));
    console.log('packageMap saved to file');
    const endDate = new Date();
    console.log('completed in ' + (endDate - startDate) + 'ms');
  });
  
} catch (err) {
  console.error('error parsing packages.json', err);
}
