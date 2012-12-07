CFLAGS := $(CFLAGS) -Wno-unused-result

all:
	$(CC) -o spawn_wrapper spawn_wrapper.c -O2 $(CXXFLAGS)
clean:
	rm -f spawn_wrapper
