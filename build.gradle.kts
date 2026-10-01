tasks.register<Exec>("assembleDebug") {
    commandLine("npm", "run", "build")
}

tasks.register("build") {
    dependsOn("assembleDebug")
}

tasks.register("lint") {
    dependsOn("assembleDebug")
}
