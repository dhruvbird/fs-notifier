#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {
    int r, i;
    r = setpgid(0, 0);
    if (argc < 2) {
        fprintf(stderr, "Please specify the process to invoke\n");
        exit(1);
    }
    r = execv(argv[1], &argv[1]);
    return r;
}
